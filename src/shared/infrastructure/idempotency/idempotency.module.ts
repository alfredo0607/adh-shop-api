import { Global, Module } from '@nestjs/common';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { CLOCK_PORT, type ClockPort } from '../../domain/clock.port';
import { ENVIRONMENT, type Environment } from '../config/environment';
import { DYNAMODB_CLIENT } from '../persistence/dynamodb.provider';
import { DynamoIdempotencyStore } from './dynamo-idempotency.store';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IDEMPOTENCY_STORE, type IdempotencyStore } from './idempotency.store';

/** Global so any route that moves money can declare the interceptor. */
@Global()
@Module({
  providers: [
    {
      provide: IDEMPOTENCY_STORE,
      inject: [DYNAMODB_CLIENT, ENVIRONMENT, CLOCK_PORT],
      useFactory: (
        client: DynamoDBDocumentClient,
        environment: Environment,
        clock: ClockPort,
      ): IdempotencyStore =>
        new DynamoIdempotencyStore(client, environment.DYNAMODB_TABLE_NAME, clock),
    },
    IdempotencyInterceptor,
  ],
  exports: [IDEMPOTENCY_STORE, IdempotencyInterceptor],
})
export class IdempotencyModule {}
