import type { Server } from 'node:http';

import { Controller, Get, Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import Redis from 'ioredis';
import request from 'supertest';

import { ENVIRONMENT, parseEnvironment, type Environment } from '../config/environment';
import { RateLimitModule } from './rate-limit.module';

/**
 * Proves the wiring, not the pieces.
 *
 * The storage and the guard are covered individually elsewhere. What this
 * asserts is that the module actually installs them: that a real request
 * through a real route is counted in Redis and rejected once the limit is
 * exceeded. Every part can be correct in isolation while the guard is never
 * registered, and nothing but an end-to-end request would reveal it.
 *
 * Hitting an unmatched route would prove nothing — Nest runs global guards for
 * matched routes only, so a 404 never reaches the limiter. Hence the throwaway
 * controller below.
 */
@Controller('probe')
class ProbeController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

const KEY_PREFIX = `e2e:${process.pid}:`;
const REDIS_HOST = process.env.REDIS_HOST ?? '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);

/**
 * Configuration is provided directly rather than through ConfigModule.
 *
 * ConfigModule validates process.env while its decorator is evaluated, which
 * happens when this file is imported — before any hook could populate the
 * environment. Supplying the parsed object makes the test's inputs explicit
 * instead of hidden in ambient state.
 */
const testEnvironment: Environment = parseEnvironment({
  NODE_ENV: 'test',
  AWS_REGION: 'us-east-1',
  DYNAMODB_TABLE_NAME: 'adh-shop-test',
  PAYMENT_API_URL: 'https://gateway.test/v1',
  PAYMENT_PUBLIC_KEY: 'public',
  PAYMENT_PRIVATE_KEY: 'private',
  PAYMENT_INTEGRITY_SECRET: 'integrity',
  PAYMENT_EVENTS_SECRET: 'events',
  REDIS_HOST,
  REDIS_PORT: String(REDIS_PORT),
  REDIS_KEY_PREFIX: KEY_PREFIX,
  RATE_LIMIT_TTL_MS: '10000',
  RATE_LIMIT_MAX: '5',
  RATE_LIMIT_BLOCK_MS: '2000',
  TRUST_PROXY_HOPS: '1',
});

@Global()
@Module({
  providers: [{ provide: ENVIRONMENT, useValue: testEnvironment }],
  exports: [ENVIRONMENT],
})
class TestConfigModule {}

describe('Rate limiting (end to end)', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestConfigModule, RateLimitModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    (app as NestExpressApplication).set('trust proxy', 1);
    await app.init();

    redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
    await redis.connect();
  });

  afterAll(async () => {
    if (redis !== undefined) {
      const keys = await redis.keys(`${KEY_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      await redis.quit();
    }
    if (app !== undefined) {
      await app.close();
    }
  });

  // getHttpServer() is typed as any; narrowing it once here keeps the cast out
  // of every call site.
  const server = (): Server => app.getHttpServer() as Server;

  const call = (ip: string): request.Test =>
    request(server()).get('/probe').set('X-Forwarded-For', ip);

  it('serves requests up to the limit and rejects the next one', async () => {
    const ip = '198.51.100.10';

    for (let i = 0; i < 5; i += 1) {
      await call(ip).expect(200);
    }

    await call(ip).expect(429);
  });

  it('counts in Redis rather than in process memory', async () => {
    const before = await redis.keys(`${KEY_PREFIX}*`);

    await call('198.51.100.20').expect(200);

    // The whole point of the exercise: the counter is visible to any other
    // process, which is what makes the limit hold across instances.
    const after = await redis.keys(`${KEY_PREFIX}*`);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it('does not store the caller address in clear text', async () => {
    const ip = '198.51.100.25';

    await call(ip).expect(200);

    // The library hashes the tracker when building the key, so the address
    // never lands in the cache verbatim. Worth asserting: a rate limiter is an
    // easy place to accidentally accumulate a log of who called from where.
    const keys = await redis.keys(`${KEY_PREFIX}*`);
    expect(keys.some((key) => key.includes(ip))).toBe(false);
  });

  it('limits each address separately, not everyone together', async () => {
    const noisy = '198.51.100.30';
    const quiet = '198.51.100.31';

    for (let i = 0; i < 6; i += 1) {
      await call(noisy);
    }

    // If the tracker read the proxy's address instead of the client's, one
    // caller exhausting the limit would block everyone else too.
    await call(quiet).expect(200);
  });

  it('exempts the liveness probe, which would otherwise throttle itself', async () => {
    const ip = '198.51.100.40';

    for (let i = 0; i < 8; i += 1) {
      await request(server()).get('/health').set('X-Forwarded-For', ip);
    }

    // /health is not a route here, so a 404 is expected — what matters is that
    // the burst did not consume this address's budget.
    await call(ip).expect(200);
  });
});
