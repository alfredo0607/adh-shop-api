import { createIamAuthToken } from './iam-auth-token';

/**
 * Signing is local — no network call — so these assert the shape ElastiCache
 * accepts. Getting it wrong produces a token the server rejects as malformed
 * rather than as unauthorised, which sends anyone debugging it towards
 * permissions instead of towards the signature.
 */
const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

const token = (
  overrides: Partial<Parameters<typeof createIamAuthToken>[0]> = {},
): Promise<string> =>
  createIamAuthToken({
    cacheName: 'adh-shop-cache',
    userId: 'adh-shop-cache-iam',
    region: 'us-east-1',
    credentials,
    ...overrides,
  });

describe('createIamAuthToken', () => {
  it('signs against the cache name, not an endpoint hostname', async () => {
    const result = await token();

    // The endpoint carries a generated suffix and is a different host. Signing
    // against it yields a token the server will not accept.
    expect(result.startsWith('adh-shop-cache/?')).toBe(true);
    expect(result).not.toContain('serverless');
    expect(result).not.toContain('cache.amazonaws.com');
  });

  it('omits the scheme, which the server refuses', async () => {
    const result = await token();

    expect(result.startsWith('https://')).toBe(false);
    expect(result.startsWith('http://')).toBe(false);
  });

  it('names the connect action and the user', async () => {
    const query = new URLSearchParams((await token()).split('?')[1]);

    expect(query.get('Action')).toBe('connect');
    expect(query.get('User')).toBe('adh-shop-cache-iam');
  });

  it('carries a SigV4 signature scoped to elasticache in the right region', async () => {
    const query = new URLSearchParams((await token()).split('?')[1]);

    expect(query.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(query.get('X-Amz-Credential')).toContain('us-east-1/elasticache/aws4_request');
    expect(query.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('caps the lifetime at the fifteen minutes ElastiCache allows', async () => {
    const query = new URLSearchParams((await token({ expiresInSeconds: 86_400 })).split('?')[1]);

    // Asking for longer is silently ignored by the service; capping here means
    // the token we sign is the token that works.
    expect(Number(query.get('X-Amz-Expires'))).toBe(900);
  });

  it('honours a shorter lifetime', async () => {
    const query = new URLSearchParams((await token({ expiresInSeconds: 60 })).split('?')[1]);

    expect(Number(query.get('X-Amz-Expires'))).toBe(60);
  });

  it('produces a different signature for a different user', async () => {
    const [mine, other] = await Promise.all([token(), token({ userId: 'someone-else' })]);

    // The user is part of what is signed, so a token cannot be replayed as a
    // different identity.
    expect(mine).not.toBe(other);
  });
});
