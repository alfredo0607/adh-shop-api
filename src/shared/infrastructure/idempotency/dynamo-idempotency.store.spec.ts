import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

import { DomainHttpException } from '../http/domain-http.exception';
import { DynamoIdempotencyStore } from './dynamo-idempotency.store';

interface Sent {
  input: Record<string, unknown>;
}

describe('DynamoIdempotencyStore', () => {
  const NOW = new Date('2026-09-24T18:00:00.000Z');
  const clock = { now: (): Date => NOW };

  const storeReturning = (
    handler: (command: Sent) => unknown,
  ): { store: DynamoIdempotencyStore; sent: Sent[] } => {
    const sent: Sent[] = [];
    const client = {
      send: (command: Sent): Promise<unknown> => {
        sent.push(command);
        const result = handler(command);
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
    } as unknown as DynamoDBDocumentClient;

    return { store: new DynamoIdempotencyStore(client, 'table', clock), sent };
  };

  const heldBy = (item: Record<string, unknown>): ConditionalCheckFailedException =>
    new ConditionalCheckFailedException({
      message: 'The conditional request failed',
      $metadata: {},
      Item: marshall(item),
    });

  it('starts a request and schedules the key for deletion by the table TTL', async () => {
    const { store, sent } = storeReturning(() => ({}));

    const result = await store.begin('key-1234567890abcdef', 'fp');

    expect(result).toEqual({ outcome: 'STARTED' });
    const item = sent[0]?.input['Item'] as Record<string, unknown>;
    expect(item['PK']).toBe('IDEMPOTENCY#key-1234567890abcdef');
    expect(item['expiresAt']).toBe(NOW.getTime() / 1000 + 24 * 60 * 60);
    expect(sent[0]?.input['ReturnValuesOnConditionCheckFailure']).toBe('ALL_OLD');
  });

  it('replays the stored response of a completed request', async () => {
    const { store } = storeReturning(() =>
      heldBy({ state: 'COMPLETED', fingerprint: 'fp', statusCode: 202, body: '{"id":"t-1"}' }),
    );

    const result = await store.begin('key', 'fp');

    expect(result).toEqual({ outcome: 'REPLAY', statusCode: 202, body: { id: 't-1' } });
  });

  it('refuses a retry while the first request is still running', async () => {
    const { store } = storeReturning(() => heldBy({ state: 'IN_PROGRESS', fingerprint: 'fp' }));

    await expect(store.begin('key', 'fp')).rejects.toMatchObject({
      domainError: { code: 'IDEMPOTENT_REQUEST_IN_PROGRESS' },
    });
  });

  it('refuses a key reused for a different request', async () => {
    const { store } = storeReturning(() => heldBy({ state: 'COMPLETED', fingerprint: 'other' }));

    const attempt = store.begin('key', 'fp');

    await expect(attempt).rejects.toBeInstanceOf(DomainHttpException);
    await expect(attempt).rejects.toMatchObject({
      domainError: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('lets any other store failure propagate', async () => {
    const { store } = storeReturning(() => new Error('throttled'));

    await expect(store.begin('key', 'fp')).rejects.toThrow('throttled');
  });

  it('completes a request, bound to its fingerprint', async () => {
    const { store, sent } = storeReturning(() => ({}));

    await store.complete('key', 'fp', 202, { id: 't-1' });

    expect(sent[0]?.input['ConditionExpression']).toBe('#fingerprint = :fingerprint');
    expect(sent[0]?.input['ExpressionAttributeValues']).toMatchObject({
      ':statusCode': 202,
      ':body': '{"id":"t-1"}',
    });
  });

  it('abandons only an unfinished request, never a stored response', async () => {
    const { store, sent } = storeReturning(() => ({}));

    await store.abandon('key');

    expect(sent[0]?.input['ConditionExpression']).toBe('#state = :inProgress');
  });
});
