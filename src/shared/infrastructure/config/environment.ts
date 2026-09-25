import { z } from 'zod';

/**
 * Schema for every environment variable this service reads.
 *
 * Validation happens once, at boot. A missing or malformed variable stops the
 * process immediately with a message naming the offending keys, rather than
 * surfacing hours later as an unexplained 500 on whichever endpoint happens to
 * touch it first. In a container this turns a silent misconfiguration into a
 * failed deployment, which is where it belongs.
 *
 * Note that the payment gateway base URL is configuration, never a constant.
 * The endpoint differs per environment, and hardcoding a vendor endpoint would
 * put knowledge of the vendor inside the codebase that the ports-and-adapters
 * boundary exists to keep out.
 */
export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    AWS_REGION: z.string().min(1, 'AWS_REGION is required'),
    DYNAMODB_TABLE_NAME: z.string().min(1, 'DYNAMODB_TABLE_NAME is required'),
    /** Set only when pointing at DynamoDB Local; unset in deployed environments. */
    DYNAMODB_ENDPOINT: z.string().url().optional(),

    PAYMENT_API_URL: z.string().url('PAYMENT_API_URL must be a valid URL'),
    PAYMENT_PUBLIC_KEY: z.string().min(1, 'PAYMENT_PUBLIC_KEY is required'),
    PAYMENT_PRIVATE_KEY: z.string().min(1, 'PAYMENT_PRIVATE_KEY is required'),
    PAYMENT_INTEGRITY_SECRET: z.string().min(1, 'PAYMENT_INTEGRITY_SECRET is required'),
    PAYMENT_EVENTS_SECRET: z.string().min(1, 'PAYMENT_EVENTS_SECRET is required'),
    PAYMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    /** Fees are pricing policy, not code. Amounts are integer cents, never floats. */
    BASE_FEE_IN_CENTS: z.coerce.number().int().nonnegative().default(500_00),
    DELIVERY_FEE_IN_CENTS: z.coerce.number().int().nonnegative().default(1_200_00),
    /**
     * How long units stay reserved for an unpaid transaction. Long enough to
     * type a card number and pass a bank challenge; short enough that an
     * abandoned checkout does not keep the last unit off the shelf.
     */
    RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().max(120).default(15),
    /** How often expired reservations are returned to stock. 0 turns it off. */
    RESERVATION_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().nonnegative().default(60),

    CORS_ALLOWED_ORIGINS: z.string().default(''),
    RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_BLOCK_MS: z.coerce.number().int().positive().default(60_000),

    /**
     * How many proxy hops to trust when deriving the client address.
     *
     * This number decides who gets rate limited, and both directions of error are
     * serious. Too low and every request appears to come from the proxy, so all
     * callers share one bucket and a single client can lock out everyone. Too
     * high and a caller can forge X-Forwarded-For to look like a different
     * address on every request, evading the limiter entirely.
     *
     * 0 for direct connections, which is correct locally. Behind CloudFront and
     * nginx it is 2: CloudFront sets the client address, nginx appends
     * CloudFront's.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().max(10).default(0),

    /**
     * Rate limit counters. Absent, the limiter falls back to in-process storage,
     * which is correct for a single instance and silently wrong for more than
     * one: each process would enforce the limit separately, multiplying it.
     */
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.coerce.number().int().positive().max(65535).default(6379),
    /** Empty for a local instance with no auth, and never set when using IAM. */
    REDIS_PASSWORD: z.string().optional(),
    REDIS_USERNAME: z.string().optional(),
    REDIS_TLS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    REDIS_KEY_PREFIX: z.string().default('ratelimit:'),
    /**
     * Cache name for IAM authentication. Present means authenticate with a signed
     * token instead of a password; absent means a plain instance, as locally.
     *
     * This is the cache's name, not its endpoint hostname — the token is signed
     * against the former and the two differ.
     */
    REDIS_CACHE_NAME: z.string().optional(),
    /**
     * When the counter store is unreachable: true keeps serving without a limit,
     * false rejects. Failing open is the default because losing the cache should
     * not take a storefront down, but it is a deliberate trade and worth being
     * able to invert.
     */
    RATE_LIMIT_FAIL_OPEN: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    /**
     * Product images are served from a private bucket through CloudFront, and
     * only with a URL this service signs. All three are required in production;
     * locally they can be left out and image keys are returned unsigned.
     */
    CDN_DOMAIN: z.string().optional(),
    CDN_KEY_PAIR_ID: z.string().optional(),
    /**
     * The PEM key, base64-encoded. It is multi-line and an env file cannot carry
     * that, so the deploy script publishes it encoded under this name.
     */
    CDN_PRIVATE_KEY_BASE64: z.string().optional(),
    /** Minimum validity of an issued image URL; see CloudFrontImageUrlSigner. */
    IMAGE_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') return;

    for (const key of ['CDN_DOMAIN', 'CDN_KEY_PAIR_ID', 'CDN_PRIVATE_KEY_BASE64'] as const) {
      if (!environment[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required in production, or product images cannot be served`,
        });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export const ENVIRONMENT = Symbol('Environment');

/**
 * Parses and validates the raw environment.
 *
 * Throws on failure, listing every invalid key at once. Reporting them one at a
 * time would mean one failed deploy per missing variable.
 */
export const parseEnvironment = (source: NodeJS.ProcessEnv): Environment => {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
};
