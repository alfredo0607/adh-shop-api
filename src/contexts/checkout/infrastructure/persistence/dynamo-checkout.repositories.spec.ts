import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { NOW, aTransaction } from '../../__fixtures__/checkout.fixture';
import { Delivery } from '../../domain/delivery';
import { DynamoCustomerRepository, customerKey } from './dynamo-customer.repository';
import { DynamoDeliveryRepository } from './dynamo-delivery.repository';
import {
  DynamoTransactionRepository,
  PENDING_PARTITION,
  type TransactionItem,
  toDeliveryItem,
  toItem,
} from './dynamo-transaction.repository';

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

describe('DynamoTransactionRepository', () => {
  it('creates the transaction without ever overwriting an existing one', async () => {
    const { client, sent } = buildClient(() => ({}));
    const transaction = aTransaction();

    const result = await new DynamoTransactionRepository(client, 'table').create(transaction);

    expect(result.isOk()).toBe(true);
    expect(sent[0]?.input['ConditionExpression']).toBe('attribute_not_exists(PK)');
    expect((sent[0]?.input['Item'] as TransactionItem).PK).toBe(`TRANSACTION#${transaction.id}`);
  });

  it('indexes a pending transaction by its reservation deadline, never under the TTL attribute', () => {
    const item = toItem(aTransaction());

    expect(item.GSI1PK).toBe(PENDING_PARTITION);
    expect(item.GSI1SK).toBe(item.reservationExpiresAt);
    // The table's TTL deletes rows by `expiresAt`. An order must never carry it.
    expect(item).not.toHaveProperty('expiresAt');
  });

  it('round-trips a transaction through its stored form', async () => {
    const transaction = aTransaction();
    const { client } = buildClient(() => ({ Item: toItem(transaction) }));

    const result = await new DynamoTransactionRepository(client, 'table').findById(transaction.id);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.id).toBe(transaction.id);
    expect(result.value.createdAt).toEqual(NOW);
    expect({ ...result.value.quote }).toEqual({ ...transaction.quote });
    expect({ ...result.value.deliveryAddress }).toEqual({ ...transaction.deliveryAddress });
    expect(result.value.customer.email).toBe('laura@example.com');
  });

  it('answers not found when there is no such item', async () => {
    const { client } = buildClient(() => ({}));

    const result = await new DynamoTransactionRepository(client, 'table').findById('missing');

    expect(result.isErr() && result.error.code).toBe('TRANSACTION_NOT_FOUND');
  });

  it('reports a malformed stored row as unavailable rather than serving it', async () => {
    const item = { ...toItem(aTransaction()), country: 'XX' };
    const { client } = buildClient(() => ({ Item: item }));

    const result = await new DynamoTransactionRepository(client, 'table').findById('x');

    expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });

  it.each(['create', 'findById'] as const)('translates a store failure on %s', async (method) => {
    const { client } = buildClient(() => new Error('socket reset'));
    const repository = new DynamoTransactionRepository(client, 'table');

    const result =
      method === 'create'
        ? await repository.create(aTransaction())
        : await repository.findById('x');

    expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });
});

describe('DynamoTransactionRepository payment writes', () => {
  const conditionFailed = (): ConditionalCheckFailedException =>
    new ConditionalCheckFailedException({ message: 'failed', $metadata: {} });

  const claimed = (): ReturnType<typeof aTransaction> => {
    const result = aTransaction().claimPayment(new Date(NOW.getTime() + 1_000));
    if (result.isErr()) throw new Error('claim should succeed');
    return result.value;
  };

  it('claims only a PENDING transaction that nobody has claimed yet', async () => {
    const { client, sent } = buildClient(() => ({}));

    const result = await new DynamoTransactionRepository(client, 'table').claimPayment(claimed());

    expect(result.isOk()).toBe(true);
    expect(sent[0]?.input['ConditionExpression']).toBe(
      'attribute_exists(PK) AND #status = :pending AND attribute_not_exists(#paymentClaimedAt)',
    );
  });

  it('tells the loser of a claim race that the transaction is no longer payable', async () => {
    const { client } = buildClient(() => conditionFailed());

    const result = await new DynamoTransactionRepository(client, 'table').claimPayment(claimed());

    expect(result.isErr() && result.error.code).toBe('TRANSACTION_NOT_PAYABLE');
  });

  it('translates any other failure while claiming', async () => {
    const { client } = buildClient(() => new Error('throttled'));

    const result = await new DynamoTransactionRepository(client, 'table').claimPayment(claimed());

    expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });

  it('updates under an optimistic lock on the previous version', async () => {
    const { client, sent } = buildClient(() => ({}));
    const recorded = claimed().recordGatewayPayment('gw-1', NOW);

    await new DynamoTransactionRepository(client, 'table').update(recorded);

    expect(sent[0]?.input['ConditionExpression']).toBe('#version = :previous');
    expect(sent[0]?.input['ExpressionAttributeValues']).toEqual({
      ':previous': recorded.version - 1,
    });
    expect((sent[0]?.input['Item'] as TransactionItem).gatewayTransactionId).toBe('gw-1');
  });

  it.each([
    ['a concurrent write', conditionFailed()],
    ['a store failure', new Error('throttled')],
  ])('reports %s during an update as unavailable', async (_case, failure) => {
    const { client } = buildClient(() => failure);

    const result = await new DynamoTransactionRepository(client, 'table').update(claimed());

    expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });

  it('round-trips the payment fields', async () => {
    const recorded = claimed().recordGatewayPayment('gw-1', NOW);
    const { client } = buildClient(() => ({ Item: toItem(recorded) }));

    const result = await new DynamoTransactionRepository(client, 'table').findById(recorded.id);

    expect(result.isOk() && result.value.gatewayTransactionId).toBe('gw-1');
    expect(result.isOk() && result.value.paymentClaimedAt).toEqual(recorded.paymentClaimedAt);
  });
});

describe('DynamoTransactionRepository settlement', () => {
  interface TransactItem {
    Put?: { Item: Record<string, unknown>; ConditionExpression: string };
    Update?: {
      Key: Record<string, unknown>;
      UpdateExpression: string;
      ConditionExpression: string;
    };
  }

  const settled = (status: 'APPROVED' | 'DECLINED'): ReturnType<typeof aTransaction> => {
    const result = aTransaction().settle(status, NOW);
    if (result === undefined) throw new Error('fixture should settle');
    return result;
  };

  const itemsOf = (sent: { input: Record<string, unknown> }[]): TransactItem[] =>
    sent[0]?.input['TransactItems'] as TransactItem[];

  it('approves, sells the units and creates the delivery in one transaction', async () => {
    const { client, sent } = buildClient(() => ({}));
    const approved = settled('APPROVED');

    const result = await new DynamoTransactionRepository(client, 'table').saveSettlement(
      approved,
      Delivery.forApproved(approved, NOW),
    );

    const [transaction, stock, delivery] = itemsOf(sent);
    expect(result.isOk()).toBe(true);
    expect(transaction?.Put?.ConditionExpression).toBe(
      '#status = :pending AND #version = :previous',
    );
    // Settled: it leaves the index of open reservations.
    expect(transaction?.Put?.Item).not.toHaveProperty('GSI1PK');
    expect(stock?.Update?.Key).toEqual({ PK: 'PRODUCT#prod-01', SK: '#META' });
    expect(stock?.Update?.UpdateExpression).not.toContain('#available');
    expect(stock?.Update?.ConditionExpression).toBe('#reserved >= :units');
    expect(delivery?.Put?.Item['SK']).toBe('#DELIVERY');
  });

  it('returns the units to the shelf when the payment did not go through', async () => {
    const { client, sent } = buildClient(() => ({}));

    await new DynamoTransactionRepository(client, 'table').saveSettlement(
      settled('DECLINED'),
      undefined,
    );

    const items = itemsOf(sent);
    expect(items).toHaveLength(2);
    expect(items[1]?.Update?.UpdateExpression).toContain('#available = #available + :units');
  });

  const cancelled = (codes: string[]): TransactionCanceledException =>
    new TransactionCanceledException({
      message: 'cancelled',
      $metadata: {},
      CancellationReasons: codes.map((Code) => ({ Code })),
    });

  it('recognises that another writer settled first', async () => {
    const { client } = buildClient(() => cancelled(['ConditionalCheckFailed', 'None']));

    const result = await new DynamoTransactionRepository(client, 'table').saveSettlement(
      settled('DECLINED'),
      undefined,
    );

    expect(result.isErr() && result.error.code).toBe('SETTLEMENT_CONFLICT');
  });

  it('does not mistake a stock inconsistency for a harmless race', async () => {
    const { client } = buildClient(() => cancelled(['None', 'ConditionalCheckFailed']));

    const result = await new DynamoTransactionRepository(client, 'table').saveSettlement(
      settled('DECLINED'),
      undefined,
    );

    expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });
});

describe('DynamoTransactionRepository expired reservations', () => {
  it('reads overdue reservations from the sparse index by deadline', async () => {
    const overdue = toItem(aTransaction());
    const { client, sent } = buildClient(() => ({
      Items: [overdue, { ...overdue, country: 'XX' }],
    }));

    const result = await new DynamoTransactionRepository(client, 'table').findExpiredReservations(
      NOW,
      25,
    );

    expect(sent[0]?.input).toMatchObject({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pending AND GSI1SK < :now',
      Limit: 25,
    });
    // The malformed second row is skipped, not allowed to block the rest.
    expect(result.isOk() && result.value.map((t) => t.id)).toEqual([overdue.id]);
  });

  it('translates a store failure', async () => {
    const { client } = buildClient(() => new Error('throttled'));

    const result = await new DynamoTransactionRepository(client, 'table').findExpiredReservations(
      NOW,
      25,
    );

    expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });
});

describe('DynamoDeliveryRepository', () => {
  const approved = aTransaction().settle('APPROVED', NOW);
  if (approved === undefined) throw new Error('fixture should settle');
  const delivery = Delivery.forApproved(approved, NOW);

  it('reads the delivery stored under its transaction', async () => {
    const { client, sent } = buildClient(() => ({ Item: toDeliveryItem(delivery) }));

    const result = await new DynamoDeliveryRepository(client, 'table').findByTransactionId(
      approved.id,
    );

    expect(sent[0]?.input['Key']).toEqual({ PK: `TRANSACTION#${approved.id}`, SK: '#DELIVERY' });
    expect(result.isOk() && result.value.estimatedDeliveryAt).toEqual(delivery.estimatedDeliveryAt);
    expect(result.isOk() && result.value.recipientPhone).toBe(delivery.recipientPhone);
  });

  it('answers not found when the transaction has no delivery', async () => {
    const { client } = buildClient(() => ({}));

    const result = await new DynamoDeliveryRepository(client, 'table').findByTransactionId('x');

    expect(result.isErr() && result.error.code).toBe('DELIVERY_NOT_FOUND');
  });

  it.each([
    ['a malformed row', { Item: { ...toDeliveryItem(delivery), country: 'XX' } }],
    ['a store failure', new Error('throttled')],
  ])('reports %s as unavailable', async (_case, response) => {
    const { client } = buildClient(() => response);

    const result = await new DynamoDeliveryRepository(client, 'table').findByTransactionId('x');

    expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });
});

describe('DynamoCustomerRepository', () => {
  const details = { fullName: 'Laura Gómez', email: 'laura@example.com', phone: '+573001234567' };
  const clock = { now: (): Date => NOW };

  it('upserts by a hash of the email, keeping the id of a returning buyer', async () => {
    const { client, sent } = buildClient(() => ({
      Attributes: { ...details, id: 'existing-id' },
    }));

    const result = await new DynamoCustomerRepository(client, 'table', clock).register(
      details,
      'new-id',
    );

    expect(result.isOk() && result.value.id).toBe('existing-id');
    expect(sent[0]?.input['Key']).toEqual({ PK: customerKey(details.email), SK: '#PROFILE' });
    expect(sent[0]?.input['UpdateExpression']).toContain('if_not_exists(#id, :id)');
    expect(JSON.stringify(sent[0]?.input['Key'])).not.toContain('laura');
  });

  it('translates a store failure', async () => {
    const { client } = buildClient(() => new Error('throttled'));

    const result = await new DynamoCustomerRepository(client, 'table', clock).register(
      details,
      'new-id',
    );

    expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });
});
