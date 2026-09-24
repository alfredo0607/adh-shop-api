import type { RedisOptions } from 'ioredis';

const constructed: RedisOptions[] = [];
const handlers = new Map<string, (arg: Error) => void>();
const connect = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);

jest.mock('ioredis', () => ({
  __esModule: true,
  default: class {
    constructor(options: RedisOptions) {
      constructed.push(options);
    }
    on(event: string, handler: (arg: Error) => void): this {
      handlers.set(event, handler);
      return this;
    }
    connect = connect;
  },
}));

import { parseEnvironment, type Environment } from '../config/environment';
import { createRedisClient } from './redis.provider';

const environmentWith = (overrides: NodeJS.ProcessEnv = {}): Environment =>
  parseEnvironment({
    AWS_REGION: 'us-east-1',
    DYNAMODB_TABLE_NAME: 'adh-shop-test',
    PAYMENT_API_URL: 'https://gateway.test/v1',
    PAYMENT_PUBLIC_KEY: 'public',
    PAYMENT_PRIVATE_KEY: 'private',
    PAYMENT_INTEGRITY_SECRET: 'integrity',
    PAYMENT_EVENTS_SECRET: 'events',
    REDIS_HOST: 'cache.test',
    ...overrides,
  });

describe('createRedisClient', () => {
  beforeEach(() => {
    constructed.length = 0;
    handlers.clear();
  });

  const lastOptions = (): RedisOptions => {
    const options = constructed.at(-1);
    if (options === undefined) {
      throw new Error('no client was constructed');
    }
    return options;
  };

  it('takes host, port and credentials from configuration', () => {
    createRedisClient(environmentWith({ REDIS_PORT: '6380', REDIS_PASSWORD: 'secret' }));

    expect(lastOptions()).toMatchObject({
      host: 'cache.test',
      port: 6380,
      password: 'secret',
    });
  });

  it('omits TLS for a local instance', () => {
    createRedisClient(environmentWith({ REDIS_TLS: 'false' }));

    expect(lastOptions().tls).toBeUndefined();
  });

  it('enables TLS when required, as IAM authentication is', () => {
    createRedisClient(environmentWith({ REDIS_TLS: 'true' }));

    expect(lastOptions().tls).toEqual({});
  });

  it('connects lazily, so an unreachable cache cannot stop the process starting', () => {
    createRedisClient(environmentWith());

    // The limiter fails open by design. Refusing to boot would turn a cache
    // outage into a full outage, which is the opposite of that intent.
    expect(lastOptions().lazyConnect).toBe(true);
  });

  it('bounds every wait, because the limiter sits in front of every route', () => {
    createRedisClient(environmentWith());
    const options = lastOptions();

    expect(options.connectTimeout).toBeGreaterThan(0);
    expect(options.commandTimeout).toBeGreaterThan(0);
    expect(options.maxRetriesPerRequest).toBe(1);
  });

  it('disables the offline queue so a disconnect fails fast instead of piling up latency', () => {
    createRedisClient(environmentWith());

    expect(lastOptions().enableOfflineQueue).toBe(false);
  });

  it('backs off on reconnection rather than retrying in a tight loop', () => {
    createRedisClient(environmentWith());
    const strategy = lastOptions().retryStrategy;

    expect(typeof strategy).toBe('function');
    expect(strategy?.(1)).toBeLessThan(strategy?.(10) as number);
    expect(strategy?.(1_000)).toBeLessThanOrEqual(5_000);
  });

  it('handles the error event, since an unhandled one would kill the process', () => {
    createRedisClient(environmentWith());

    expect(handlers.has('error')).toBe(true);
    expect(() => handlers.get('error')?.(new Error('ECONNREFUSED'))).not.toThrow();
  });

  it('reports a successful connection', () => {
    createRedisClient(environmentWith());

    expect(handlers.has('ready')).toBe(true);
    expect(() => handlers.get('ready')?.(new Error('unused'))).not.toThrow();
  });

  it('swallows a failed initial connection and retries in the background', async () => {
    connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    expect(() => createRedisClient(environmentWith())).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
