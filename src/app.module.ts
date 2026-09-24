import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { ConfigModule } from './shared/infrastructure/config/config.module';
import { ENVIRONMENT, type Environment } from './shared/infrastructure/config/environment';
import { buildLoggerOptions } from './shared/infrastructure/observability/logger.config';
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
  ],
})
export class AppModule {}
