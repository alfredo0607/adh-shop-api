import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { ConfigModule } from './shared/infrastructure/config/config.module';
import { ENVIRONMENT, type Environment } from './shared/infrastructure/config/environment';
import { buildLoggerOptions } from './shared/infrastructure/observability/logger.config';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule,
    SharedModule,

    LoggerModule.forRootAsync({
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment) => buildLoggerOptions(environment),
    }),

    // Applied globally rather than per-route: an endpoint that is accidentally
    // left unthrottled is a denial-of-service vector, and the safe default is
    // for protection to be opt-out instead of opt-in.
    ThrottlerModule.forRootAsync({
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment) => [
        { ttl: environment.RATE_LIMIT_TTL_MS, limit: environment.RATE_LIMIT_MAX },
      ],
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
