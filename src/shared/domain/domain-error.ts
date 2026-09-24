/**
 * Base type for every error that travels on the failure track of a `Result`.
 *
 * A domain error is an expected business outcome — out of stock, card declined,
 * product not found — not a defect. Defects are thrown and handled at the edge.
 */

/**
 * Transport-agnostic classification of a failure.
 *
 * The domain says *what kind* of failure occurred; it does not know that HTTP
 * exists. Translating a kind into a status code is the job of the HTTP adapter,
 * which keeps the dependency rule intact: a domain error carrying `404` would
 * make the core aware of its delivery mechanism, and the same error would then
 * be meaningless when raised from a queue consumer or a scheduled job.
 */
export type ErrorKind =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'UNEXPECTED';

export abstract class DomainError {
  /**
   * Stable, machine-readable identifier. Clients branch on this, so it is part
   * of the public contract and must not change once released.
   */
  abstract readonly code: string;

  /** How the failure should be interpreted by whatever is delivering it. */
  abstract readonly kind: ErrorKind;

  constructor(
    readonly message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {}
}

/**
 * Wraps an unexpected fault from an adapter — a rejected AWS SDK call, a socket
 * reset — so it can travel on the railway instead of escaping as an exception.
 *
 * `cause` is retained for logging and must never reach a client response: it
 * routinely contains table names, key schemas and driver internals.
 */
export class UnexpectedFailure extends DomainError {
  readonly code = 'UNEXPECTED_FAILURE';
  readonly kind = 'UNEXPECTED' as const;

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}
