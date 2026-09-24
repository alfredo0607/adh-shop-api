import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { Redis } from 'ioredis';

/**
 * Counts requests in Redis so the limit is shared across every process.
 *
 * The whole increment happens inside a Lua script, which Redis runs atomically.
 * The obvious implementation — INCR then EXPIRE — is two round trips, and a
 * client that dies between them leaves a counter with no expiry. That key never
 * resets, so the caller it belongs to is rate limited permanently. The failure
 * is rare, silent, and only ever affects real users.
 *
 * Returns milliseconds; the caller converts. The @nestjs/throttler contract is
 * asymmetric — ttl and blockDuration arrive in milliseconds while timeToExpire
 * and timeToBlockExpire are expected in seconds — and getting that backwards
 * produces windows a thousand times too long, which looks like the limiter
 * simply not working.
 */
const INCREMENT_SCRIPT = `
local blockKey = KEYS[2]
local blockPttl = redis.call('PTTL', blockKey)

-- Already blocked: report the remaining block without touching the counter,
-- so hammering the endpoint cannot extend its own penalty.
if blockPttl > 0 then
  return { tonumber(ARGV[2]) + 1, 0, 1, blockPttl }
end

local hitsKey = KEYS[1]
local hits = redis.call('INCR', hitsKey)
local pttl = redis.call('PTTL', hitsKey)

-- PTTL returns -1 for a key with no expiry, which is the state a crash between
-- INCR and EXPIRE would leave behind. Setting it here makes the window
-- self-healing rather than permanent.
if pttl < 0 then
  redis.call('PEXPIRE', hitsKey, ARGV[1])
  pttl = tonumber(ARGV[1])
end

if hits > tonumber(ARGV[2]) then
  redis.call('SET', blockKey, 1, 'PX', ARGV[3])
  redis.call('DEL', hitsKey)
  return { hits, 0, 1, tonumber(ARGV[3]) }
end

return { hits, pttl, 0, 0 }
`;

type ScriptResult = [totalHits: number, ttlMs: number, blocked: number, blockMs: number];

interface RedisWithIncrement extends Redis {
  rateLimitIncrement(
    hitsKey: string,
    blockKey: string,
    ttlMs: string,
    limit: string,
    blockMs: string,
  ): Promise<ScriptResult>;
}

/**
 * Builds the pair of key names for one caller, tied to the same hash slot.
 *
 * A clustered Redis refuses any command touching two keys that live in
 * different slots — `CROSSSLOT Keys in request don't hash to the same slot` —
 * and the script touches both the counter and the block marker. Wrapping the
 * shared part in braces makes only that substring decide the slot, so the two
 * keys are guaranteed to land together however the cluster is resharded.
 *
 * This is invisible on a standalone server, which accepts the same script
 * regardless. The limiter therefore passes locally and fails in production,
 * where failing open means it quietly stops limiting anything.
 *
 * Braces are stripped from the caller's own identity because a stray one would
 * close the tag early and split the pair again — the same silent failure, found
 * the same expensive way. Two callers sharing a bucket is the lesser harm.
 */
export const buildKeys = (
  keyPrefix: string,
  throttlerName: string,
  key: string,
): { hitsKey: string; blockKey: string } => {
  const hitsKey = `${keyPrefix}{${throttlerName}:${key.replace(/[{}]/g, '')}}`;

  return { hitsKey, blockKey: `${hitsKey}:blocked` };
};

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: RedisWithIncrement;

  constructor(
    redis: Redis,
    private readonly keyPrefix: string,
    private readonly failOpen: boolean,
  ) {
    // defineCommand registers the script once and invokes it through EVALSHA,
    // falling back to EVAL only when the server has not seen it yet. Sending
    // the whole script on every request would waste bandwidth on the hot path.
    redis.defineCommand('rateLimitIncrement', { numberOfKeys: 2, lua: INCREMENT_SCRIPT });
    this.redis = redis as RedisWithIncrement;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const { hitsKey, blockKey } = buildKeys(this.keyPrefix, throttlerName, key);

    try {
      const [totalHits, ttlMs, blocked, blockMs] = await this.redis.rateLimitIncrement(
        hitsKey,
        blockKey,
        String(ttl),
        String(limit),
        String(blockDuration),
      );

      return {
        totalHits,
        timeToExpire: Math.ceil(ttlMs / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(blockMs / 1000),
      };
    } catch (cause) {
      return this.onStoreUnavailable(cause, ttl, limit);
    }
  }

  /**
   * Fails open by default: the storefront keeps serving, unthrottled.
   *
   * The alternative is rejecting every request while the cache is down, which
   * turns a cache outage into a full outage. Rate limiting protects against
   * abuse; it is not worth trading availability for, and an attack that happens
   * to coincide with a Redis failure is a narrower risk than the site being
   * unreachable. Logged at error level because running unthrottled is not a
   * state anyone should discover from a bill.
   */
  private onStoreUnavailable(cause: unknown, ttl: number, limit: number): ThrottlerStorageRecord {
    this.logger.error(
      `Rate limit store unavailable, ${this.failOpen ? 'allowing' : 'rejecting'} the request`,
      cause instanceof Error ? cause.stack : String(cause),
    );

    if (!this.failOpen) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(ttl / 1000),
      };
    }

    return {
      totalHits: 0,
      timeToExpire: Math.ceil(ttl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
