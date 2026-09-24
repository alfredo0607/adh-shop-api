import { Sha256 } from '@aws-crypto/sha256-js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';

/**
 * Produces the short-lived token ElastiCache accepts in place of a password.
 *
 * There is no password anywhere in this system. The host presents its instance
 * role, AWS signs a request that says "this identity may connect as this user",
 * and the cache verifies that signature. Nothing durable is stored, so nothing
 * durable can leak — and permission is revoked by editing an IAM policy rather
 * than by rotating a secret through every consumer.
 *
 * The token is a presigned request to the `connect` action, with the scheme
 * stripped. That shape is not obvious and neither is the host it must be signed
 * against: the CACHE NAME, not the endpoint hostname. They differ, because the
 * endpoint carries a generated suffix, and signing against the endpoint yields
 * a token the server rejects as malformed rather than as unauthorised — a
 * confusing place to begin debugging.
 */

export interface IamAuthTokenRequest {
  /** The cache's name, which is the host the request is signed against. */
  readonly cacheName: string;
  /** The ElastiCache user id, which must equal the user name for IAM auth. */
  readonly userId: string;
  readonly region: string;
  /**
   * How long the token stays valid, capped by ElastiCache at 15 minutes.
   *
   * Only the connection handshake uses it: once authenticated, the session
   * survives the token's expiry. What this really bounds is how long a stolen
   * token could be used to open a new connection.
   */
  readonly expiresInSeconds?: number;
  /**
   * Credentials to sign with. Omitted, the standard chain resolves them:
   * environment, profile, container, then instance metadata.
   *
   * Injectable so the signature can be asserted against a known key rather than
   * against whatever the machine running the test happens to be holding.
   */
  readonly credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
}

const MAX_EXPIRY_SECONDS = 900;

export const createIamAuthToken = async (request: IamAuthTokenRequest): Promise<string> => {
  const expiresIn = Math.min(request.expiresInSeconds ?? MAX_EXPIRY_SECONDS, MAX_EXPIRY_SECONDS);

  const signer = new SignatureV4({
    service: 'elasticache',
    region: request.region,
    // The standard chain: environment, profile, container, then instance
    // metadata. On the deployed host it resolves to the instance role, so the
    // credentials this signs with are themselves short-lived.
    credentials: request.credentials ?? fromNodeProviderChain(),
    sha256: Sha256,
  });

  const presigned = await signer.presign(
    new HttpRequest({
      method: 'GET',
      protocol: 'https:',
      hostname: request.cacheName,
      path: '/',
      query: { Action: 'connect', User: request.userId },
      headers: { host: request.cacheName },
    }),
    { expiresIn },
  );

  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(presigned.query ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }
    query.set(key, Array.isArray(value) ? (value[0] ?? '') : value);
  }

  // The token is the presigned URL without its scheme. Leaving "https://" on
  // the front is accepted by the signer and refused by the server.
  return `${request.cacheName}/?${query.toString()}`;
};
