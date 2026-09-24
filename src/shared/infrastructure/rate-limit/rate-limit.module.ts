import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageService } from '@nestjs/throttler/dist/throttler.service';
import type Redis from 'ioredis';

import { ENVIRONMENT, type Environment } from '../config/environment';
import { ClientIpThrottlerGuard } from './client-ip.throttler-guard';
import { REDIS_CLIENT, createRedisClient } from './redis.provider';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Wires the rate limiter to a shared counter store when one is configured.
 *
 * Without REDIS_HOST the limiter falls back to the library's in-process
 * storage. That is correct for exactly one instance and silently wrong for
 * more: each process would keep its own counters, so the effective limit is
 * the configured one multiplied by the number of instances. The fallback logs
 * that, because a limit that quietly does not apply is worse than none — it
 * reads as protection on a dashboard while providing none.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment) => ({
        throttlers: [
          {
            ttl: environment.RATE_LIMIT_TTL_MS,
            limit: environment.RATE_LIMIT_MAX,
            blockDuration: environment.RATE_LIMIT_BLOCK_MS,
          },
        ],
      }),
    }),
  ],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): Redis | null =>
        environment.REDIS_HOST === undefined ? null : createRedisClient(environment),
    },
    {
      provide: ThrottlerStorage,
      inject: [ENVIRONMENT, REDIS_CLIENT],
      useFactory: (environment: Environment, redis: Redis | null): ThrottlerStorage => {
        const logger = new Logger('RateLimit');

        if (redis === null) {
          logger.warn(
            'REDIS_HOST is not set: rate limit counters are per-process. ' +
              'Correct for a single instance, and multiplied by the instance count beyond that.',
          );
          return new ThrottlerStorageService();
        }

        logger.log(`Rate limit counters shared through ${environment.REDIS_HOST}`);
        return new RedisThrottlerStorage(
          redis,
          environment.REDIS_KEY_PREFIX,
          environment.RATE_LIMIT_FAIL_OPEN,
        );
      },
    },
    // Applied globally rather than per route: an endpoint left unthrottled by
    // accident is a denial-of-service vector, so protection is opt-out.
    { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
  ],
  exports: [ThrottlerStorage],
})
export class RateLimitModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  /**
   * Closes the connection on SIGTERM so the socket is released and any command
   * already in flight completes. Without this the process can exit while the
   * server still holds the connection open, which shows up as a slow drain
   * during a deployment.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.redis !== null) {
      await this.redis.quit();
    }
  }
}
