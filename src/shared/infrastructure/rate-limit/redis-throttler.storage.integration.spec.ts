import Redis from 'ioredis';

import { RedisThrottlerStorage, buildKeys } from './redis-throttler.storage';

/**
 * Exercised against a real Redis, because the behaviour under test lives inside
 * a Lua script the server executes. A mocked client would assert that the right
 * string was sent and prove nothing about what Redis does with it — which is
 * precisely where the atomicity guarantee either holds or does not.
 *
 * Runs against REDIS_HOST, defaulting to a local instance. CI provides one as a
 * service container.
 */
const HOST = process.env.REDIS_HOST ?? '127.0.0.1';
const PORT = Number(process.env.REDIS_PORT ?? 6379);
const PREFIX = `test:${process.pid}:`;

describe('RedisThrottlerStorage (integration)', () => {
  let redis: Redis;
  let storage: RedisThrottlerStorage;

  beforeAll(async () => {
    redis = new Redis({ host: HOST, port: PORT, lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    storage = new RedisThrottlerStorage(redis, PREFIX, true);
  });

  afterAll(async () => {
    const keys = await redis.keys(`${PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.quit();
  });

  const uniqueKey = (): string => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  describe('counting within a window', () => {
    it('increments on each call and reports the hits so far', async () => {
      const key = uniqueKey();

      const first = await storage.increment(key, 10_000, 5, 10_000, 'default');
      const second = await storage.increment(key, 10_000, 5, 10_000, 'default');

      expect(first.totalHits).toBe(1);
      expect(second.totalHits).toBe(2);
      expect(second.isBlocked).toBe(false);
    });

    it('reports the remaining window in seconds, not milliseconds', async () => {
      const key = uniqueKey();

      const record = await storage.increment(key, 10_000, 5, 10_000, 'default');

      // The contract is asymmetric: ttl arrives in milliseconds, timeToExpire
      // is expected in seconds. Returning 10000 here would make the limiter
      // appear not to work at all.
      expect(record.timeToExpire).toBeGreaterThan(0);
      expect(record.timeToExpire).toBeLessThanOrEqual(10);
    });

    it('does not extend the window on subsequent hits', async () => {
      const key = uniqueKey();

      const first = await storage.increment(key, 3_000, 10, 3_000, 'default');
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const later = await storage.increment(key, 3_000, 10, 3_000, 'default');

      // A fixed window must expire from its first hit. If each call reset the
      // expiry, a steady stream of traffic would hold the window open forever
      // and the counter would never reset.
      expect(later.timeToExpire).toBeLessThan(first.timeToExpire);
    });
  });

  describe('blocking', () => {
    it('blocks once the limit is exceeded', async () => {
      const key = uniqueKey();

      for (let i = 0; i < 3; i += 1) {
        await storage.increment(key, 10_000, 3, 5_000, 'default');
      }
      const exceeded = await storage.increment(key, 10_000, 3, 5_000, 'default');

      expect(exceeded.isBlocked).toBe(true);
      expect(exceeded.timeToBlockExpire).toBeGreaterThan(0);
      expect(exceeded.timeToBlockExpire).toBeLessThanOrEqual(5);
    });

    it('stays blocked without extending its own penalty', async () => {
      const key = uniqueKey();

      for (let i = 0; i < 4; i += 1) {
        await storage.increment(key, 10_000, 3, 5_000, 'default');
      }

      const first = await storage.increment(key, 10_000, 3, 5_000, 'default');
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const second = await storage.increment(key, 10_000, 3, 5_000, 'default');

      expect(second.isBlocked).toBe(true);
      // Hammering the endpoint while blocked must not restart the block, or a
      // caller could never recover from one.
      expect(second.timeToBlockExpire).toBeLessThanOrEqual(first.timeToBlockExpire);
    });

    it('releases the caller once the block expires', async () => {
      const key = uniqueKey();

      for (let i = 0; i < 3; i += 1) {
        await storage.increment(key, 10_000, 2, 1_000, 'default');
      }
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      const afterBlock = await storage.increment(key, 10_000, 2, 1_000, 'default');

      expect(afterBlock.isBlocked).toBe(false);
      expect(afterBlock.totalHits).toBe(1);
    });
  });

  describe('atomicity', () => {
    it('counts every hit when they arrive concurrently', async () => {
      const key = uniqueKey();

      const results = await Promise.all(
        Array.from({ length: 50 }, () => storage.increment(key, 10_000, 1_000, 10_000, 'default')),
      );

      // Read-modify-write across two round trips would lose increments under
      // this load. Inside a Lua script the server serialises them, so every
      // number from 1 to 50 appears exactly once.
      const hits = results.map((record) => record.totalHits).sort((a, b) => a - b);
      expect(hits).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    });

    it('never leaves a counter without an expiry', async () => {
      const key = uniqueKey();

      await storage.increment(key, 5_000, 10, 5_000, 'default');
      const ttl = await redis.pttl(buildKeys(PREFIX, 'default', key).hitsKey);

      // -1 means the key exists with no expiry, which is the state a crash
      // between INCR and EXPIRE would leave. That counter would never reset and
      // the caller would be limited permanently.
      expect(ttl).toBeGreaterThan(0);
    });

    it('recovers a counter that somehow lost its expiry', async () => {
      const key = uniqueKey();
      const hitsKey = buildKeys(PREFIX, 'default', key).hitsKey;

      // Simulate the damaged state directly.
      await redis.set(hitsKey, '3');
      expect(await redis.pttl(hitsKey)).toBe(-1);

      await storage.increment(key, 5_000, 10, 5_000, 'default');

      expect(await redis.pttl(hitsKey)).toBeGreaterThan(0);
    });
  });

  describe('isolation', () => {
    it('keeps separate counters per throttler name', async () => {
      const key = uniqueKey();

      await storage.increment(key, 10_000, 5, 10_000, 'default');
      const other = await storage.increment(key, 10_000, 5, 10_000, 'strict');

      expect(other.totalHits).toBe(1);
    });
  });
});
