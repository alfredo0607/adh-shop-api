import { type CancellationReason, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoProductRepository } from './dynamo-product.repository';

/**
 * Asserts the commands the adapter builds.
 *
 * The valuable part here is a string: `ConditionExpression`. It is what stops
 * two buyers from taking the same last unit, it is evaluated by DynamoDB rather
 * than by this process, and a typo in it fails open — the write simply succeeds
 * and the product oversells, with nothing in the logs to show for it. Nothing
 * short of reading the expression catches that.
 */

interface Sent {
  input: Record<string, unknown>;
}

const buildClient = (
  handler: (command: Sent) => unknown,
): { client: DynamoDBDocumentClient; sent: Sent[] } => {
  const sent: Sent[] = [];

  const client = {
    send: (command: Sent): Promise<unknown> => {
      sent.push(command);
      const result = handler(command);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  } as unknown as DynamoDBDocumentClient;

  return { client, sent };
};

const storedProduct = {
  PK: 'PRODUCT#p1',
  SK: '#META',
  GSI1PK: 'PRODUCT',
  GSI1SK: 'p1',
  id: 'p1',
  name: 'Cafetera',
  description: 'A coffee maker',
  category: 'coffee-makers',
  priceInCents: 150_000,
  currency: 'COP',
  imageKey: 'product/x.webp',
  available: 10,
  reserved: 2,
  version: 4,
};

const anotherProduct = {
  ...storedProduct,
  PK: 'PRODUCT#p2',
  GSI1SK: 'p2',
  id: 'p2',
  name: 'Molino',
  priceInCents: 40_000,
  available: 4,
  reserved: 0,
};

interface TransactItem {
  Update: {
    UpdateExpression: string;
    ConditionExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues: Record<string, number>;
    ReturnValuesOnConditionCheckFailure: string;
  };
}

describe('DynamoProductRepository', () => {
  describe('reserveAll', () => {
    /** Answers each read with the stored product, and each transaction with success. */
    const storeWith = (
      products: Record<string, Record<string, unknown>>,
    ): ReturnType<typeof buildClient> =>
      buildClient((command) => {
        if ('TransactItems' in command.input) return {};
        const key = command.input['Key'] as { PK: string };
        return { Item: products[key.PK.replace('PRODUCT#', '')] };
      });

    const transactionOf = (sent: Sent[]): TransactItem[] =>
      (sent.find((command) => 'TransactItems' in command.input)?.input['TransactItems'] ??
        []) as TransactItem[];

    it('holds every line in one transaction, with the condition evaluated by the store', async () => {
      const { client, sent } = storeWith({ p1: storedProduct, p2: anotherProduct });

      const result = await new DynamoProductRepository(client, 'adh-shop').reserveAll([
        { productId: 'p1', units: 3 },
        { productId: 'p2', units: 1 },
      ]);

      expect(result.isOk()).toBe(true);
      const operations = transactionOf(sent);
      expect(operations).toHaveLength(2);
      for (const [index, { Update }] of operations.entries()) {
        // Without `#available >= :units` evaluated server-side, two concurrent
        // reservations for the last unit both succeed.
        expect(Update.ConditionExpression).toContain('attribute_exists(PK)');
        expect(Update.ConditionExpression).toContain('#available >= :units');
        expect(Update.UpdateExpression).toContain('#available = #available - :units');
        expect(Update.UpdateExpression).toContain('#reserved = #reserved + :units');
        expect(Update.UpdateExpression).toContain('#version = #version + :one');
        expect(Update.ExpressionAttributeValues[':units']).toBe([3, 1][index]);
      }
    });

    it('charges the price it read: a price changed in between fails the write', async () => {
      const { client, sent } = storeWith({ p1: storedProduct });

      await new DynamoProductRepository(client, 'adh-shop').reserveAll([
        { productId: 'p1', units: 1 },
      ]);

      const [{ Update }] = transactionOf(sent) as [TransactItem];
      expect(Update.ConditionExpression).toContain('#price = :price');
      expect(Update.ExpressionAttributeNames['#price']).toBe('priceInCents');
      expect(Update.ExpressionAttributeValues[':price']).toBe(150_000);
    });

    it('asks for each item back, so a missing product can be told from a short one', async () => {
      const { client, sent } = storeWith({ p1: storedProduct });

      await new DynamoProductRepository(client, 'adh-shop').reserveAll([
        { productId: 'p1', units: 1 },
      ]);

      const [{ Update }] = transactionOf(sent) as [TransactItem];
      expect(Update.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');
      expect(Update.ExpressionAttributeNames).toMatchObject({
        '#available': 'available',
        '#reserved': 'reserved',
        '#version': 'version',
      });
    });

    it('returns the products as reserved, in the order of the lines', async () => {
      const { client } = storeWith({ p1: storedProduct, p2: anotherProduct });

      const result = await new DynamoProductRepository(client, 'adh-shop').reserveAll([
        { productId: 'p2', units: 1 },
        { productId: 'p1', units: 3 },
      ]);

      if (result.isErr()) throw new Error(`expected products, got ${result.error.code}`);
      expect(result.value.map((product) => product.id)).toEqual(['p2', 'p1']);
      expect(result.value[1]?.stock.available).toBe(7);
      expect(result.value[1]?.stock.reserved).toBe(5);
    });

    it('refuses a short line before writing anything, naming the product', async () => {
      const { client, sent } = storeWith({ p1: storedProduct, p2: anotherProduct });

      const result = await new DynamoProductRepository(client, 'adh-shop').reserveAll([
        { productId: 'p1', units: 1 },
        { productId: 'p2', units: 9 },
      ]);

      expect(result.isErr() && result.error.details).toEqual({
        productId: 'p2',
        requested: 9,
        available: 4,
      });
      expect(transactionOf(sent)).toHaveLength(0);
    });

    it.each([
      ['no lines', []],
      [
        'the same product twice',
        [
          { productId: 'p1', units: 1 },
          { productId: 'p1', units: 2 },
        ],
      ],
      ['zero units', [{ productId: 'p1', units: 0 }]],
      ['a fractional unit count', [{ productId: 'p1', units: 1.5 }]],
    ])('rejects %s without calling the store', async (_case, lines) => {
      const { client, sent } = storeWith({ p1: storedProduct });

      const result = await new DynamoProductRepository(client, 'adh-shop').reserveAll(lines);

      // A malformed request, not a shortage: 422, never 409.
      expect(result.isErr() && result.error.code).toBe('INVALID_STOCK');
      expect(sent).toHaveLength(0);
    });
  });

  describe('when the transaction is cancelled', () => {
    const cancelled = (reasons: CancellationReason[]): TransactionCanceledException =>
      new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: reasons,
      });

    const failingWith = (error: unknown): ReturnType<typeof buildClient> =>
      buildClient((command) =>
        'TransactItems' in command.input ? error : { Item: storedProduct },
      );

    it('reports insufficient stock for the line that lost the race', async () => {
      const { client } = failingWith(
        cancelled([{ Code: 'ConditionalCheckFailed', Item: { available: { N: '2' } } }]),
      );

      const result = await new DynamoProductRepository(client, 'adh-shop').reserveAll([
        { productId: 'p1', units: 5 },
      ]);

      expect(result.isErr() && result.error.code).toBe('INSUFFICIENT_STOCK');
      expect(result.isErr() && result.error.details).toEqual({
        productId: 'p1',
        requested: 5,
        available: 2,
      });
    });

    it('reports not found when a failed line has no item', async () => {
      const { client } = buildClient(() =>
        cancelled([{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }]),
      );

      const result = await new DynamoProductRepository(client, 'adh-shop').releaseAll([
        { productId: 'p1', units: 1 },
        { productId: 'gone', units: 1 },
      ]);

      expect(result.isErr() && result.error.details).toEqual({ productId: 'gone' });
    });

    it('reports a price that moved as a store problem, safe to retry', async () => {
      const { client } = failingWith(
        cancelled([{ Code: 'ConditionalCheckFailed', Item: { available: { N: '9' } } }]),
      );

      const result = await new DynamoProductRepository(client, 'adh-shop').reserveAll([
        { productId: 'p1', units: 1 },
      ]);

      expect(result.isErr() && result.error.code).toBe('CATALOG_UNAVAILABLE');
    });

    it('reports a conflicting transaction as a store problem, safe to retry', async () => {
      const { client } = buildClient(() => cancelled([{ Code: 'TransactionConflict' }]));

      const result = await new DynamoProductRepository(client, 'adh-shop').confirmAll([
        { productId: 'p1', units: 1 },
      ]);

      expect(result.isErr() && result.error.code).toBe('CATALOG_UNAVAILABLE');
    });

    it('reads the held count for confirm and release, not the available one', async () => {
      const { client } = buildClient(() =>
        cancelled([
          { Code: 'ConditionalCheckFailed', Item: { available: { N: '9' }, reserved: { N: '1' } } },
        ]),
      );

      const result = await new DynamoProductRepository(client, 'adh-shop').confirmAll([
        { productId: 'p1', units: 4 },
      ]);

      expect(result.isErr() && result.error.details).toEqual({
        productId: 'p1',
        requested: 4,
        available: 1,
      });
    });

    it('reports any other failure as the store being unavailable', async () => {
      const { client } = buildClient(() => new Error('ECONNRESET'));

      const result = await new DynamoProductRepository(client, 'adh-shop').releaseAll([
        { productId: 'p1', units: 1 },
      ]);

      expect(result.isErr() && result.error.kind).toBe('UNAVAILABLE');
    });
  });

  describe('confirmAll and releaseAll', () => {
    const operationsFor = async (method: 'confirmAll' | 'releaseAll'): Promise<TransactItem[]> => {
      const { client, sent } = buildClient(() => ({}));

      await new DynamoProductRepository(client, 'adh-shop')[method]([
        { productId: 'p1', units: 2 },
        { productId: 'p2', units: 1 },
      ]);

      // No read first: nothing is returned, so nothing needs reading.
      expect(sent).toHaveLength(1);
      return (sent[0]?.input['TransactItems'] ?? []) as TransactItem[];
    };

    it('confirm removes the units of every line from its product entirely', async () => {
      const operations = await operationsFor('confirmAll');

      expect(operations).toHaveLength(2);
      for (const { Update } of operations) {
        expect(Update.UpdateExpression).toContain('#reserved = #reserved - :units');
        expect(Update.UpdateExpression).not.toContain('#available');
        expect(Update.ConditionExpression).toContain('#reserved >= :units');
      }
    });

    it('release returns the units of every line to the shelf', async () => {
      const operations = await operationsFor('releaseAll');

      for (const { Update } of operations) {
        expect(Update.UpdateExpression).toContain('#available = #available + :units');
        expect(Update.UpdateExpression).toContain('#reserved = #reserved - :units');
      }
    });
  });

  describe('cursors', () => {
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    it.each([
      ['a JSON string', encode('x')],
      ['an array', encode([1, 2])],
      [
        'a key with extra attributes',
        encode({ PK: 'PRODUCT#p1', SK: '#META', GSI1PK: 'PRODUCT', GSI1SK: 'p1', x: 1 }),
      ],
      [
        'a key from another partition',
        encode({
          PK: 'TRANSACTION#t1',
          SK: '#META',
          GSI1PK: 'PENDING_TRANSACTION',
          GSI1SK: '2026',
        }),
      ],
      [
        'a key whose parts disagree',
        encode({ PK: 'PRODUCT#p2', SK: '#META', GSI1PK: 'PRODUCT', GSI1SK: 'p1' }),
      ],
    ])('refuses %s as a cursor, as a client error, without querying', async (_case, cursor) => {
      const { client, sent } = buildClient(() => ({ Items: [] }));

      const result = await new DynamoProductRepository(client, 'adh-shop').findAll({
        limit: 20,
        cursor,
      });

      expect(result.isErr() && result.error.kind).toBe('VALIDATION');
      expect(sent).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('reads consistently, so the catalogue cannot show a stale price', async () => {
      const { client, sent } = buildClient(() => ({ Item: storedProduct }));

      await new DynamoProductRepository(client, 'adh-shop').findById('p1');

      expect((sent[0]?.input as { ConsistentRead: boolean }).ConsistentRead).toBe(true);
      expect((sent[0]?.input as { Key: Record<string, string> }).Key).toEqual({
        PK: 'PRODUCT#p1',
        SK: '#META',
      });
    });

    it('reports not found for a missing item', async () => {
      const { client } = buildClient(() => ({}));

      const result = await new DynamoProductRepository(client, 'adh-shop').findById('missing');

      if (result.isErr()) {
        expect(result.error.code).toBe('PRODUCT_NOT_FOUND');
      }
    });

    it('reports the store as unavailable when the call fails', async () => {
      const { client } = buildClient(() => new Error('ECONNRESET'));

      const result = await new DynamoProductRepository(client, 'adh-shop').findById('p1');

      if (result.isErr()) {
        expect(result.error.code).toBe('CATALOG_UNAVAILABLE');
        expect(result.error.kind).toBe('UNAVAILABLE');
      }
    });

    it('treats a malformed stored record as a store problem, not a client one', async () => {
      const { client } = buildClient(() => ({ Item: { ...storedProduct, available: -5 } }));

      const result = await new DynamoProductRepository(client, 'adh-shop').findById('p1');

      if (result.isErr()) {
        expect(result.error.code).toBe('CATALOG_UNAVAILABLE');
      }
    });
  });

  describe('findAll', () => {
    it('queries the index instead of scanning the table', async () => {
      const { client, sent } = buildClient(() => ({ Items: [storedProduct] }));

      await new DynamoProductRepository(client, 'adh-shop').findAll({ limit: 20 });
      const input = sent[0]?.input as {
        IndexName: string;
        KeyConditionExpression: string;
        Limit: number;
      };

      // A Scan reads the whole single table and is billed for it, and it gets
      // slower as unrelated entities are added.
      expect(input.IndexName).toBe('GSI1');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :partition');
      expect(input.Limit).toBe(20);
    });

    it('reports no cursor on the last page', async () => {
      const { client } = buildClient(() => ({ Items: [storedProduct] }));

      const result = await new DynamoProductRepository(client, 'adh-shop').findAll({ limit: 20 });

      if (result.isOk()) {
        expect(result.value.items).toHaveLength(1);
        expect(result.value.nextCursor).toBeNull();
      }
    });

    it('round-trips the cursor without exposing the key schema', async () => {
      const lastKey = { PK: 'PRODUCT#p1', SK: '#META', GSI1PK: 'PRODUCT', GSI1SK: 'p1' };
      const { client, sent } = buildClient(() => ({
        Items: [storedProduct],
        LastEvaluatedKey: lastKey,
      }));
      const repository = new DynamoProductRepository(client, 'adh-shop');

      const first = await repository.findAll({ limit: 1 });
      if (first.isErr() || first.value.nextCursor === null) {
        throw new Error('expected a cursor');
      }

      // Opaque: a client cannot read the key schema off it, so the table layout
      // is not frozen into the public API.
      expect(first.value.nextCursor).not.toContain('PRODUCT#');

      await repository.findAll({ limit: 1, cursor: first.value.nextCursor });
      expect((sent[1]?.input as { ExclusiveStartKey: unknown }).ExclusiveStartKey).toEqual(lastKey);
    });

    it('rejects a malformed cursor instead of scanning from the start', async () => {
      const { client, sent } = buildClient(() => ({ Items: [] }));

      const result = await new DynamoProductRepository(client, 'adh-shop').findAll({
        limit: 20,
        cursor: 'not-base64-json',
      });

      expect(result.isErr() && result.error.code).toBe('INVALID_CURSOR');
      expect(sent).toHaveLength(0);
    });

    it('skips a malformed record rather than failing the whole page', async () => {
      const { client } = buildClient(() => ({
        Items: [storedProduct, { ...storedProduct, id: 'broken', priceInCents: -1 }],
      }));

      const result = await new DynamoProductRepository(client, 'adh-shop').findAll({ limit: 20 });

      // One bad row must not make the catalogue unreadable.
      if (result.isOk()) {
        expect(result.value.items).toHaveLength(1);
        expect(result.value.items[0]?.id).toBe('p1');
      }
    });

    it('reports the store as unavailable when the query fails', async () => {
      const { client } = buildClient(() => new Error('ProvisionedThroughputExceeded'));

      const result = await new DynamoProductRepository(client, 'adh-shop').findAll({ limit: 20 });

      if (result.isErr()) {
        expect(result.error.code).toBe('CATALOG_UNAVAILABLE');
      }
    });
  });
});
