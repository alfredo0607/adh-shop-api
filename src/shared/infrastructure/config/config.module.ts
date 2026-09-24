import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { ENVIRONMENT, parseEnvironment, type Environment } from './environment';

/**
 * Global so that no feature module has to import it, and so that nothing is
 * tempted to read `process.env` directly. Every consumer injects the validated,
 * typed `Environment` object instead.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Loaded only outside production; deployed environments receive their
      // configuration from the task definition and Parameter Store.
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate: parseEnvironment,
    }),
  ],
  providers: [
    {
      provide: ENVIRONMENT,
      useFactory: (): Environment => parseEnvironment(process.env),
    },
  ],
  exports: [ENVIRONMENT],
})
export class ConfigModule {}
