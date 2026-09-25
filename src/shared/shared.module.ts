import { Global, Module } from '@nestjs/common';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { CLOCK_PORT } from './domain/clock.port';
import { ID_GENERATOR_PORT } from './domain/id-generator.port';
import { SystemClock } from './infrastructure/clock/system.clock';
import { ENVIRONMENT, type Environment } from './infrastructure/config/environment';
import { HealthController } from './infrastructure/health/health.controller';
import { UuidIdGenerator } from './infrastructure/identity/uuid.id-generator';
import {
  DYNAMODB_CLIENT,
  createDynamoDbClient,
} from './infrastructure/persistence/dynamodb.provider';

/**
 * Binds the shared ports to their adapters.
 *
 * Global because every context needs the clock and the id generator, and having
 * each feature module import this one would be noise. Ports are bound by symbol
 * so that consumers depend on the interface rather than on the class, which is
 * what makes them replaceable in a test.
 */
@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: CLOCK_PORT, useClass: SystemClock },
    { provide: ID_GENERATOR_PORT, useClass: UuidIdGenerator },
    // One client for the whole process: it pools connections, and every
    // context writes to the same table.
    {
      provide: DYNAMODB_CLIENT,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): DynamoDBDocumentClient =>
        createDynamoDbClient(environment),
    },
  ],
  exports: [CLOCK_PORT, ID_GENERATOR_PORT, DYNAMODB_CLIENT],
})
export class SharedModule {}
