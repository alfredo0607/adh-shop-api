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
export const environmentSchema = z.object({
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

  CORS_ALLOWED_ORIGINS: z.string().default(''),
  RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
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
