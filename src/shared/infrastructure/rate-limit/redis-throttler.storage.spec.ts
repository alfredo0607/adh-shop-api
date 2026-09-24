import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

import { RedisThrottlerStorage } from './redis-throttler.storage';

type Script = jest.Mock<Promise<[number, number, number, number]>, string[]>;

// The mock is returned alongside the client rather than read back off it:
// accessing a method through the object and passing it around detaches `this`,
// which the linter flags for good reason.
const buildRedis = (script: Script): { redis: Redis; defineCommand: jest.Mock } => {
  const defineCommand = jest.fn();
  const redis = { defineCommand, rateLimitIncrement: script } as unknown as Redis;

  return { redis, defineCommand };
};

describe('RedisThrottlerStorage', () => {
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('unit conversion', () => {
    it('converts the milliseconds the script returns into the seconds the contract expects', async () => {
      const script: Script = jest.fn().mockResolvedValue([3, 7_400, 0, 0]);
      const storage = new RedisThrottlerStorage(buildRedis(script).redis, 'p:', true);

      const record = await storage.increment('client', 10_000, 5, 10_000, 'default');

      // 7400 ms rounds up to 8 s. Returning 7400 would make the limiter look
      // broken: callers would be told to wait two hours.
      expect(record).toEqual({
        totalHits: 3,
        timeToExpire: 8,
        isBlocked: false,
        timeToBlockExpire: 0,
      });
    });

    it('passes the millisecond values through to the script untouched', async () => {
      const script: Script = jest.fn().mockResolvedValue([1, 60_000, 0, 0]);
      const storage = new RedisThrottlerStorage(buildRedis(script).redis, 'p:', true);

      await storage.increment('client', 60_000, 100, 30_000, 'default');

      expect(script).toHaveBeenCalledWith(
        'p:{default:client}',
        'p:{default:client}:blocked',
        '60000',
        '100',
        '30000',
      );
    });
  });

  describe('key naming', () => {
    it('namespaces by prefix and throttler so limiters cannot collide', async () => {
      const script: Script = jest.fn().mockResolvedValue([1, 1_000, 0, 0]);
      const storage = new RedisThrottlerStorage(buildRedis(script).redis, 'ratelimit:', true);

      await storage.increment('1.2.3.4', 1_000, 5, 1_000, 'strict');

      expect(script).toHaveBeenCalledWith(
        'ratelimit:{strict:1.2.3.4}',
        'ratelimit:{strict:1.2.3.4}:blocked',
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });

    // The hash tag is what a clustered Redis reads to choose a slot: the text
    // between the first brace and the next one. Both keys must expose the same
    // one, or the script is refused with CROSSSLOT and the limiter fails open —
    // which is indistinguishable, from outside, from having no limiter at all.
    const hashTag = (key: string): string => /\{([^}]*)\}/.exec(key)?.[1] ?? '';

    it('gives both keys the same hash tag, so a clustered server accepts the script', async () => {
      const script: Script = jest.fn().mockResolvedValue([1, 1_000, 0, 0]);
      const storage = new RedisThrottlerStorage(buildRedis(script).redis, 'ratelimit:', true);

      await storage.increment('1.2.3.4', 1_000, 5, 1_000, 'strict');

      const [hitsKey, blockKey] = script.mock.calls[0] as [string, string];

      expect(hashTag(hitsKey)).toBe('strict:1.2.3.4');
      expect(hashTag(blockKey)).toBe(hashTag(hitsKey));
    });

    it('keeps the pair together when the tracker itself contains a brace', async () => {
      const script: Script = jest.fn().mockResolvedValue([1, 1_000, 0, 0]);
      const storage = new RedisThrottlerStorage(buildRedis(script).redis, 'ratelimit:', true);

      // A brace inside the identity would close the tag early and split the
      // keys across slots again.
      await storage.increment('cli}ent{x', 1_000, 5, 1_000, 'strict');

      const [hitsKey, blockKey] = script.mock.calls[0] as [string, string];

      expect(hashTag(hitsKey)).toBe('strict:clientx');
      expect(hashTag(blockKey)).toBe(hashTag(hitsKey));
    });

  });

  describe('when the store is unreachable', () => {
    it('fails open, so a cache outage does not become a site outage', async () => {
      const script: Script = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const storage = new RedisThrottlerStorage(buildRedis(script).redis, 'p:', true);

      const record = await storage.increment('client', 10_000, 5, 10_000, 'default');

      expect(record.isBlocked).toBe(false);
      expect(record.totalHits).toBe(0);
    });

    it('fails closed when configured to prefer protection over availability', async () => {
      const script: Script = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const storage = new RedisThrottlerStorage(buildRedis(script).redis, 'p:', false);

      const record = await storage.increment('client', 10_000, 5, 10_000, 'default');

      expect(record.isBlocked).toBe(true);
      expect(record.totalHits).toBeGreaterThan(5);
    });

    it('logs at error level either way, since running unthrottled is not a quiet state', async () => {
      const script: Script = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const storage = new RedisThrottlerStorage(buildRedis(script).redis, 'p:', true);

      await storage.increment('client', 10_000, 5, 10_000, 'default');

      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('allowing'),
        expect.stringContaining('ECONNREFUSED'),
      );
    });

    it('survives a rejection that is not an Error', async () => {
      const script: Script = jest.fn().mockRejectedValue('socket closed');
      const storage = new RedisThrottlerStorage(buildRedis(script).redis, 'p:', true);

      await expect(storage.increment('c', 1_000, 5, 1_000, 'default')).resolves.toMatchObject({
        isBlocked: false,
      });
    });
  });

  describe('script registration', () => {
    it('registers the script once so calls go through EVALSHA', () => {
      const script: Script = jest.fn().mockResolvedValue([1, 1_000, 0, 0]);
      const { redis, defineCommand } = buildRedis(script);

      new RedisThrottlerStorage(redis, 'p:', true);

      expect(defineCommand).toHaveBeenCalledWith(
        'rateLimitIncrement',
        expect.objectContaining({ numberOfKeys: 2, lua: expect.stringContaining('INCR') }),
      );
    });
  });
});
