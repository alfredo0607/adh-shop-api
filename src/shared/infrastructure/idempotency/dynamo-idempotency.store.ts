import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

import type { ClockPort } from '../../domain/clock.port';
import { DomainHttpException } from '../http/domain-http.exception';
import {
  type IdempotencyBegin,
  IdempotencyKeyReused,
  type IdempotencyStore,
  IdempotentRequestInProgress,
} from './idempotency.store';

/**
 *   PK  IDEMPOTENCY#<key>     SK  #REQUEST
 *
 * `expiresAt` is the table's TTL attribute, in epoch seconds: DynamoDB deletes
 * the record on its own once the key's retention is over.
 */
interface IdempotencyItem {
  state: 'IN_PROGRESS' | 'COMPLETED';
  fingerprint: string;
  lockedUntil: string;
  expiresAt: number;
  statusCode?: number;
  body?: string;
}

/** How long a key is remembered. Clients retry within minutes; a day is generous. */
const RETENTION_SECONDS = 24 * 60 * 60;

/**
 * How long an unfinished request holds its key. A process that dies mid-request
 * never completes or abandons it, and the key must not stay blocked forever.
 */
const LOCK_MS = 60_000;

const key = (idempotencyKey: string): { PK: string; SK: string } => ({
  PK: `IDEMPOTENCY#${idempotencyKey}`,
  SK: '#REQUEST',
});

export class DynamoIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly clock: ClockPort,
  ) {}

  async begin(idempotencyKey: string, fingerprint: string): Promise<IdempotencyBegin> {
    const now = this.clock.now();
    const nowSeconds = Math.floor(now.getTime() / 1000);

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...key(idempotencyKey),
            state: 'IN_PROGRESS',
            fingerprint,
            lockedUntil: new Date(now.getTime() + LOCK_MS).toISOString(),
            expiresAt: nowSeconds + RETENTION_SECONDS,
          },
          // Free if never used, past retention (TTL deletion lags by up to two
          // days), or held by a request that died without finishing.
          ConditionExpression:
            'attribute_not_exists(PK) OR #expiresAt < :nowSeconds OR ' +
            '(#state = :inProgress AND #lockedUntil < :now)',
          ExpressionAttributeNames: {
            '#expiresAt': 'expiresAt',
            '#state': 'state',
            '#lockedUntil': 'lockedUntil',
          },
          ExpressionAttributeValues: {
            ':nowSeconds': nowSeconds,
            ':inProgress': 'IN_PROGRESS',
            ':now': now.toISOString(),
          },
          // Hands back the record that won, so deciding what to do costs no
          // second read.
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        }),
      );

      return { outcome: 'STARTED' };
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException) || error.Item === undefined) {
        throw error;
      }

      const existing = unmarshall(error.Item) as IdempotencyItem;

      if (existing.fingerprint !== fingerprint) {
        throw new DomainHttpException(new IdempotencyKeyReused());
      }

      if (existing.state === 'IN_PROGRESS') {
        throw new DomainHttpException(new IdempotentRequestInProgress());
      }

      return {
        outcome: 'REPLAY',
        statusCode: existing.statusCode ?? 200,
        body: existing.body === undefined ? undefined : (JSON.parse(existing.body) as unknown),
      };
    }
  }

  async complete(
    idempotencyKey: string,
    fingerprint: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key(idempotencyKey),
        UpdateExpression: 'SET #state = :completed, #statusCode = :statusCode, #body = :body',
        ConditionExpression: '#fingerprint = :fingerprint',
        ExpressionAttributeNames: {
          '#state': 'state',
          '#statusCode': 'statusCode',
          '#body': 'body',
          '#fingerprint': 'fingerprint',
        },
        ExpressionAttributeValues: {
          ':completed': 'COMPLETED',
          ':statusCode': statusCode,
          ':body': JSON.stringify(body),
          ':fingerprint': fingerprint,
        },
      }),
    );
  }

  async abandon(idempotencyKey: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: key(idempotencyKey),
        // Never deletes a completed response: that is the one worth keeping.
        ConditionExpression: '#state = :inProgress',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':inProgress': 'IN_PROGRESS' },
      }),
    );
  }
}
