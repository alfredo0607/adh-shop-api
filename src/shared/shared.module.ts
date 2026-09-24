import { Global, Module } from '@nestjs/common';

import { CLOCK_PORT } from './domain/clock.port';
import { ID_GENERATOR_PORT } from './domain/id-generator.port';
import { SystemClock } from './infrastructure/clock/system.clock';
import { HealthController } from './infrastructure/health/health.controller';
import { UuidIdGenerator } from './infrastructure/identity/uuid.id-generator';

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
  ],
  exports: [CLOCK_PORT, ID_GENERATOR_PORT],
})
export class SharedModule {}
