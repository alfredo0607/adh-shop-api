import { Logger } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';

import type { Environment } from '../config/environment';
import { createIamAuthToken } from './iam-auth-token';

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
  const usesIam = environment.REDIS_CACHE_NAME !== undefined;

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

  /**
   * Replaces the password with a freshly signed token.
   *
   * An IAM token is valid for fifteen minutes and is only used by the handshake
   * — an established session outlives it. But ioredis re-sends AUTH from its
   * options on every reconnect, so a long-lived client would eventually
   * reconnect with a token that expired hours ago and fail to come back exactly
   * when the network had just recovered.
   *
   * Refreshing before each connect makes that impossible, and costs a local
   * signature rather than a network call.
   */
  const refreshToken = async (): Promise<void> => {
    if (!usesIam) {
      return;
    }

    try {
      client.options.password = await createIamAuthToken({
        cacheName: environment.REDIS_CACHE_NAME as string,
        userId: environment.REDIS_USERNAME as string,
        region: environment.AWS_REGION,
      });
    } catch (error) {
      // Logged, never thrown: the limiter fails open, and a signing failure
      // must not be louder than the outage it would cause.
      logger.warn(`Could not sign an auth token: ${(error as Error).message}`);
    }
  };

  client.on('error', (error: Error) => {
    // Logged, never rethrown: an unhandled 'error' event on an ioredis client
    // terminates the process.
    logger.warn(`Redis connection error: ${error.message}`);
  });

  client.on('ready', () => {
    logger.log(
      `Connected to ${environment.REDIS_HOST}:${environment.REDIS_PORT}` +
        (usesIam ? ' using IAM authentication' : ''),
    );
  });

  // Every reconnection signs again, so a stale token can never be presented.
  client.on('reconnecting', () => {
    void refreshToken();
  });

  void refreshToken()
    .then(() => client.connect())
    .catch((error: Error) => {
      logger.warn(`Initial Redis connection failed: ${error.message}. Retrying in the background.`);
    });

  return client;
};
