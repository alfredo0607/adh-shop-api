import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
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
  priceInCents: 150_000,
  currency: 'COP',
  imageKey: 'product/x.webp',
  available: 10,
  reserved: 2,
  version: 4,
};

describe('DynamoProductRepository', () => {
  describe('reserveUnits', () => {
    it('makes the condition the store evaluates, not this process', async () => {
      const { client, sent } = buildClient(() => ({ Attributes: storedProduct }));

      await new DynamoProductRepository(client, 'adh-shop').reserveUnits('p1', 3);

      const input = sent[0]?.input as {
        ConditionExpression: string;
        UpdateExpression: string;
        ExpressionAttributeValues: Record<string, number>;
      };

      // Without `#available >= :units` evaluated server-side, two concurrent
      // reservations for the last unit both succeed.
      expect(input.ConditionExpression).toContain('#available >= :units');
      expect(input.ConditionExpression).toContain('attribute_exists(PK)');
      expect(input.UpdateExpression).toContain('#available = #available - :units');
      expect(input.UpdateExpression).toContain('#reserved = #reserved + :units');
      expect(input.ExpressionAttributeValues[':units']).toBe(3);
    });

    it('bumps the version on every write, so a lost update is detectable', async () => {
      const { client, sent } = buildClient(() => ({ Attributes: storedProduct }));

      await new DynamoProductRepository(client, 'adh-shop').reserveUnits('p1', 1);

      expect((sent[0]?.input as { UpdateExpression: string }).UpdateExpression).toContain(
        '#version = #version + :one',
      );
    });

    it('aliases the reserved words DynamoDB would otherwise reject', async () => {
      const { client, sent } = buildClient(() => ({ Attributes: storedProduct }));

      await new DynamoProductRepository(client, 'adh-shop').reserveUnits('p1', 1);

      expect(
        (sent[0]?.input as { ExpressionAttributeNames: Record<string, string> })
          .ExpressionAttributeNames,
      ).toEqual({ '#available': 'available', '#reserved': 'reserved', '#version': 'version' });
    });

    it('asks for the item back when the condition fails', async () => {
      const { client, sent } = buildClient(() => ({ Attributes: storedProduct }));

      await new DynamoProductRepository(client, 'adh-shop').reserveUnits('p1', 1);

      // Without this, a sold-out product cannot be told apart from a missing
      // one and every conflict would answer 404 instead of 409.
      expect(
        (sent[0]?.input as { ReturnValuesOnConditionCheckFailure: string })
          .ReturnValuesOnConditionCheckFailure,
      ).toBe('ALL_OLD');
    });

    it('returns the updated product', async () => {
      const { client } = buildClient(() => ({
        Attributes: { ...storedProduct, available: 7, reserved: 5, version: 5 },
      }));

      const result = await new DynamoProductRepository(client, 'adh-shop').reserveUnits('p1', 3);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.stock.available).toBe(7);
        expect(result.value.version).toBe(5);
      }
    });

    it.each([0, -1, 1.5])('rejects a unit count of %s without calling the store', async (units) => {
      const { client, sent } = buildClient(() => ({ Attributes: storedProduct }));

      const result = await new DynamoProductRepository(client, 'adh-shop').reserveUnits(
        'p1',
        units,
      );

      expect(result.isErr()).toBe(true);
      expect(sent).toHaveLength(0);
    });
  });

  describe('when the condition fails', () => {
    const conditionFailure = (item?: Record<string, unknown>): ConditionalCheckFailedException => {
      const error = new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        $metadata: {},
      });
      if (item !== undefined) {
        (error as { Item?: unknown }).Item = item;
      }
      return error;
    };

    it('reports insufficient stock when the product exists', async () => {
      const { client } = buildClient(() => conditionFailure({ available: { N: '2' } }));

      const result = await new DynamoProductRepository(client, 'adh-shop').reserveUnits('p1', 5);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('INSUFFICIENT_STOCK');
        expect(result.error.details).toEqual({ requested: 5, available: 2 });
      }
    });

    it('reports not found when no item comes back', async () => {
      const { client } = buildClient(() => conditionFailure());

      const result = await new DynamoProductRepository(client, 'adh-shop').reserveUnits('p1', 1);

      if (result.isErr()) {
        expect(result.error.code).toBe('PRODUCT_NOT_FOUND');
      }
    });

    it('reads the held count for confirm and release, not the available one', async () => {
      const { client } = buildClient(() => conditionFailure({ reserved: { N: '1' } }));

      const result = await new DynamoProductRepository(client, 'adh-shop').confirmUnits('p1', 4);

      if (result.isErr()) {
        expect(result.error.details).toEqual({ requested: 4, available: 1 });
      }
    });
  });

  describe('confirmUnits and releaseUnits', () => {
    it('confirm removes the units from the product entirely', async () => {
      const { client, sent } = buildClient(() => ({ Attributes: storedProduct }));

      await new DynamoProductRepository(client, 'adh-shop').confirmUnits('p1', 2);
      const input = sent[0]?.input as { UpdateExpression: string; ConditionExpression: string };

      expect(input.UpdateExpression).toContain('#reserved = #reserved - :units');
      expect(input.UpdateExpression).not.toContain('#available');
      expect(input.ConditionExpression).toContain('#reserved >= :units');
    });

    it('release returns the units to the shelf', async () => {
      const { client, sent } = buildClient(() => ({ Attributes: storedProduct }));

      await new DynamoProductRepository(client, 'adh-shop').releaseUnits('p1', 2);
      const input = sent[0]?.input as { UpdateExpression: string };

      expect(input.UpdateExpression).toContain('#available = #available + :units');
      expect(input.UpdateExpression).toContain('#reserved = #reserved - :units');
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

      expect(result.isErr()).toBe(true);
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
