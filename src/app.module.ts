import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { CatalogModule } from './contexts/catalog/catalog.module';
import { CheckoutModule } from './contexts/checkout/checkout.module';
import { ConfigModule } from './shared/infrastructure/config/config.module';
import { ENVIRONMENT, type Environment } from './shared/infrastructure/config/environment';
import { buildLoggerOptions } from './shared/infrastructure/observability/logger.config';
import { IdempotencyModule } from './shared/infrastructure/idempotency/idempotency.module';
import { RateLimitModule } from './shared/infrastructure/rate-limit/rate-limit.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule,
    SharedModule,

    LoggerModule.forRootAsync({
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment) => buildLoggerOptions(environment),
    }),

    RateLimitModule,
    IdempotencyModule,

    CatalogModule,
    CheckoutModule,
  ],
})
export class AppModule {}
