import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoProductRepository } from '../../../contexts/catalog/infrastructure/persistence/dynamo-product.repository';
import { NOW, aTransaction } from '../../../contexts/checkout/__fixtures__/checkout.fixture';
import { Delivery } from '../../../contexts/checkout/domain/delivery';
import type { Transaction } from '../../../contexts/checkout/domain/transaction';
import { DynamoTransactionRepository } from '../../../contexts/checkout/infrastructure/persistence/dynamo-transaction.repository';
import type { Environment } from '../config/environment';
import { DynamoIdempotencyStore } from '../idempotency/dynamo-idempotency.store';
import { createDynamoDbClient } from './dynamodb.provider';

/**
 * The invariants this service is built on are enforced by DynamoDB, not by
 * this process: a condition expression, a transaction, a sparse index. The
 * unit specs assert the commands that are sent; only a real engine shows what
 * it does with them. A typo in a condition passes every unit test and fails
 * open in production.
 *
 * Runs against DYNAMODB_TEST_ENDPOINT, defaulting to a local instance
 * (`docker run -p 8000:8000 amazon/dynamodb-local`). CI provides one as a
 * service container. Each run creates its own table with the production key
 * schema and deletes it afterwards.
 */
const ENDPOINT = process.env['DYNAMODB_TEST_ENDPOINT'] ?? 'http://127.0.0.1:8000';
const TABLE = `adh-shop-it-${process.pid}-${Date.now()}`;

describe('Single-table persistence (integration, DynamoDB Local)', () => {
  const admin = new DynamoDBClient({
    endpoint: ENDPOINT,
    region: 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  let client: DynamoDBDocumentClient;
  let products: DynamoProductRepository;
  let transactions: DynamoTransactionRepository;

  beforeAll(async () => {
    await admin.send(
      new CreateTableCommand({
        TableName: TABLE,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );

    client = createDynamoDbClient({
      AWS_REGION: 'us-east-1',
      DYNAMODB_ENDPOINT: ENDPOINT,
    } as Environment);
    products = new DynamoProductRepository(client, TABLE);
    transactions = new DynamoTransactionRepository(client, TABLE);
  });

  afterAll(async () => {
    await admin.send(new DeleteTableCommand({ TableName: TABLE }));
    admin.destroy();
    client.destroy();
  });

  const putProduct = async (id: string, available: number, reserved = 0): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `PRODUCT#${id}`,
          SK: '#META',
          GSI1PK: 'PRODUCT',
          GSI1SK: id,
          id,
          name: `Product ${id}`,
          description: 'Integration fixture',
          priceInCents: 150_000,
          currency: 'COP',
          imageKey: `product/${id}.webp`,
          available,
          reserved,
          version: 0,
        },
      }),
    );
  };

  const stockOf = async (id: string): Promise<{ available: number; reserved: number }> => {
    const product = await products.findById(id);
    if (product.isErr()) throw new Error(`product ${id} unreadable`);
    return { available: product.value.stock.available, reserved: product.value.stock.reserved };
  };

  describe('stock', () => {
    it('never oversells: of ten concurrent buyers for three units, exactly three succeed', async () => {
      await putProduct('race', 3);

      const attempts = await Promise.all(
        Array.from({ length: 10 }, () => products.reserveUnits('race', 1)),
      );

      const won = attempts.filter((result) => result.isOk()).length;
      const refused = attempts.filter(
        (result) => result.isErr() && result.error.code === 'INSUFFICIENT_STOCK',
      ).length;
      expect({ won, refused }).toEqual({ won: 3, refused: 7 });
      expect(await stockOf('race')).toEqual({ available: 0, reserved: 3 });
    });

    it('tells a missing product from a sold-out one', async () => {
      await putProduct('empty', 0);

      const missing = await products.reserveUnits('does-not-exist', 1);
      const soldOut = await products.reserveUnits('empty', 1);

      expect(missing.isErr() && missing.error.code).toBe('PRODUCT_NOT_FOUND');
      expect(soldOut.isErr() && soldOut.error.code).toBe('INSUFFICIENT_STOCK');
    });

    it('refuses to release or confirm more than is reserved', async () => {
      await putProduct('held', 5, 1);

      const release = await products.releaseUnits('held', 2);
      const confirm = await products.confirmUnits('held', 2);

      expect(release.isErr()).toBe(true);
      expect(confirm.isErr()).toBe(true);
      expect(await stockOf('held')).toEqual({ available: 5, reserved: 1 });
    });

    it('pages the listing with a cursor the next query accepts', async () => {
      await putProduct('page-a', 1);
      await putProduct('page-b', 1);

      const first = await products.findAll({ limit: 1 });
      if (first.isErr() || first.value.nextCursor === null) throw new Error('expected a cursor');
      const second = await products.findAll({ limit: 1, cursor: first.value.nextCursor });

      expect(second.isOk()).toBe(true);
      expect(second.isOk() && second.value.items[0]?.id).not.toBe(first.value.items[0]?.id);
    });
  });

  describe('transactions', () => {
    const later = (ms: number): Date => new Date(NOW.getTime() + ms);

    const claimedCopy = (transaction: Transaction): Transaction => {
      const claimed = transaction.claimPayment(later(1_000));
      if (claimed.isErr()) throw new Error('claim should succeed');
      return claimed.value;
    };

    it('lets exactly one of two concurrent payment claims through', async () => {
      const open = aTransaction({ id: '11111111-1111-4111-8111-111111111111' });
      await transactions.create(open);

      const [a, b] = await Promise.all([
        transactions.claimPayment(claimedCopy(open)),
        transactions.claimPayment(claimedCopy(open)),
      ]);

      const outcomes = [a, b].map((result) => (result.isOk() ? 'claimed' : result.error.code));
      expect(outcomes.sort()).toEqual(['TRANSACTION_NOT_PAYABLE', 'claimed']);
    });

    it('never overwrites an existing transaction on create', async () => {
      const open = aTransaction({ id: '22222222-2222-4222-8222-222222222222' });
      await transactions.create(open);

      const again = await transactions.create(open);

      expect(again.isErr()).toBe(true);
    });

    it('settles an approval atomically: status, sold stock and delivery together', async () => {
      await putProduct('prod-01', 4, 1);
      const open = aTransaction({ id: '33333333-3333-4333-8333-333333333333' });
      await transactions.create(open);
      const approved = open.settle('APPROVED', later(2_000));
      if (approved === undefined) throw new Error('should settle');

      const result = await transactions.saveSettlement(
        approved,
        Delivery.forApproved(approved, later(2_000)),
      );

      expect(result.isOk()).toBe(true);
      const stored = await transactions.findById(open.id);
      expect(stored.isOk() && stored.value.status).toBe('APPROVED');
      expect(await stockOf('prod-01')).toEqual({ available: 4, reserved: 0 });
      const delivery = await client.send(
        new GetCommand({
          TableName: TABLE,
          Key: { PK: `TRANSACTION#${open.id}`, SK: '#DELIVERY' },
        }),
      );
      expect(delivery.Item?.['status']).toBe('PREPARING');
    });

    it('reports a second settlement of the same transaction as a conflict, changing nothing', async () => {
      await putProduct('prod-01', 4, 2);
      const open = aTransaction({ id: '44444444-4444-4444-8444-444444444444' });
      await transactions.create(open);
      const approved = open.settle('APPROVED', later(2_000));
      const declined = open.settle('DECLINED', later(2_000));
      if (approved === undefined || declined === undefined) throw new Error('should settle');

      await transactions.saveSettlement(approved, Delivery.forApproved(approved, later(2_000)));
      const late = await transactions.saveSettlement(declined, undefined);

      expect(late.isErr() && late.error.code).toBe('SETTLEMENT_CONFLICT');
      // The decline did not hand the sold unit back.
      expect(await stockOf('prod-01')).toEqual({ available: 4, reserved: 1 });
    });

    it('does not mistake a stock inconsistency for a race, and rolls everything back', async () => {
      await putProduct('prod-01', 4, 0);
      const open = aTransaction({ id: '55555555-5555-4555-8555-555555555555' });
      await transactions.create(open);
      const approved = open.settle('APPROVED', later(2_000));
      if (approved === undefined) throw new Error('should settle');

      const result = await transactions.saveSettlement(
        approved,
        Delivery.forApproved(approved, later(2_000)),
      );

      expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
      const stored = await transactions.findById(open.id);
      expect(stored.isOk() && stored.value.status).toBe('PENDING');
    });

    it('lists an overdue reservation from the sparse index, and drops it once settled', async () => {
      await putProduct('prod-01', 4, 1);
      const open = aTransaction({ id: '66666666-6666-4666-8666-666666666666' });
      await transactions.create(open);
      const pastDeadline = new Date(open.reservationExpiresAt.getTime() + 1_000);

      const before = await transactions.findExpiredReservations(pastDeadline, 100);
      const expired = open.expire(pastDeadline);
      if (expired === undefined) throw new Error('should expire');
      await transactions.saveSettlement(expired, undefined);
      const after = await transactions.findExpiredReservations(pastDeadline, 100);

      expect(before.isOk() && before.value.map((t) => t.id)).toContain(open.id);
      expect(after.isOk() && after.value.map((t) => t.id)).not.toContain(open.id);
    });
  });

  describe('idempotency keys', () => {
    it('replays a completed request and refuses a reused or concurrent one', async () => {
      const store = new DynamoIdempotencyStore(client, TABLE, { now: (): Date => new Date() });
      const key = `it-${Date.now()}-abcdefghij`;

      await expect(store.begin(key, 'fp')).resolves.toEqual({ outcome: 'STARTED' });
      await expect(store.begin(key, 'fp')).rejects.toMatchObject({
        domainError: { code: 'IDEMPOTENT_REQUEST_IN_PROGRESS' },
      });

      await store.complete(key, 'fp', 202, { id: 't-1' });

      await expect(store.begin(key, 'fp')).resolves.toEqual({
        outcome: 'REPLAY',
        statusCode: 202,
        body: { id: 't-1' },
      });
      await expect(store.begin(key, 'other')).rejects.toMatchObject({
        domainError: { code: 'IDEMPOTENCY_KEY_REUSED' },
      });
    });

    it('frees an abandoned key for a retry, but never deletes a stored response', async () => {
      const store = new DynamoIdempotencyStore(client, TABLE, { now: (): Date => new Date() });
      const abandoned = `it-${Date.now()}-abandoned-1`;
      const completed = `it-${Date.now()}-completed-1`;

      await store.begin(abandoned, 'fp');
      await store.abandon(abandoned);
      await store.begin(completed, 'fp');
      await store.complete(completed, 'fp', 202, {});

      await expect(store.begin(abandoned, 'fp')).resolves.toEqual({ outcome: 'STARTED' });
      await expect(store.abandon(completed)).rejects.toThrow();
    });
  });
});
