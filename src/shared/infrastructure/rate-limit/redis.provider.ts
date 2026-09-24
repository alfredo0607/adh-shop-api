import { Logger } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';

import type { Environment } from '../config/environment';

export const REDIS_CLIENT = Symbol('RedisClient');

/**
 * Builds the connection to the counter store.
 *
 * `lazyConnect` keeps the process from dying at boot when the cache is
 * unreachable. The limiter is designed to fail open, so an unavailable cache
 * must degrade the limit rather than the service — refusing to start would make
 * a cache outage a full outage, which is exactly what failing open avoids.
 */
export const createRedisClient = (environment: Environment): Redis => {
  const logger = new Logger('RedisClient');

  const options: RedisOptions = {
    host: environment.REDIS_HOST,
    port: environment.REDIS_PORT,
    username: environment.REDIS_USERNAME,
    password: environment.REDIS_PASSWORD,
    keyPrefix: '',
    lazyConnect: true,

    // Bounded so a request cannot hang behind a dead socket. The rate limiter
    // sits in front of every route: a slow check is a slow API.
    connectTimeout: 5_000,
    commandTimeout: 1_000,

    // Fail the command rather than queue it forever while disconnected. Queued
    // commands would surface as a growing latency spike instead of the clean
    // fall back to failing open.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,

    retryStrategy: (attempt: number): number => Math.min(attempt * 200, 5_000),

    // ElastiCache requires TLS when authenticating with IAM. A local instance
    // does not use it.
    ...(environment.REDIS_TLS ? { tls: {} } : {}),
  };

  const client = new Redis(options);

  client.on('error', (error: Error) => {
    // Logged, never rethrown: an unhandled 'error' event on an ioredis client
    // terminates the process.
    logger.warn(`Redis connection error: ${error.message}`);
  });

  client.on('ready', () => {
    logger.log(`Connected to ${environment.REDIS_HOST}:${environment.REDIS_PORT}`);
  });

  void client.connect().catch((error: Error) => {
    logger.warn(`Initial Redis connection failed: ${error.message}. Retrying in the background.`);
  });

  return client;
};
