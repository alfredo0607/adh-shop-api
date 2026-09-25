import { DomainError } from '../../domain/domain-error';

export type IdempotencyBegin =
  | { readonly outcome: 'STARTED' }
  | { readonly outcome: 'REPLAY'; readonly statusCode: number; readonly body: unknown };

/**
 * Remembers the response to each request made with an Idempotency-Key, so a
 * retried request gets the original answer instead of running again.
 */
export interface IdempotencyStore {
  /**
   * Starts a request under a key, or returns the stored response of an
   * earlier one. Fails when the key is in use by a request still running, or
   * was used for a different request.
   */
  begin(key: string, fingerprint: string): Promise<IdempotencyBegin>;

  complete(key: string, fingerprint: string, statusCode: number, body: unknown): Promise<void>;

  /** Forgets a request that failed, so the client can retry it with the same key. */
  abandon(key: string): Promise<void>;
}

export const IDEMPOTENCY_STORE = Symbol('IdempotencyStore');

/** A retry arrived while the first request was still being processed. */
export class IdempotentRequestInProgress extends DomainError {
  readonly code = 'IDEMPOTENT_REQUEST_IN_PROGRESS';
  readonly kind = 'CONFLICT' as const;

  constructor() {
    super('A request with this Idempotency-Key is still being processed; retry shortly');
  }
}

/**
 * The key was used before for a different request. Replaying the old answer
 * would be wrong, and running the new request would defeat the key.
 */
export class IdempotencyKeyReused extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  readonly kind = 'VALIDATION' as const;

  constructor() {
    super('This Idempotency-Key was already used for a different request');
  }
}
