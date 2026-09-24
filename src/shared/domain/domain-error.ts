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
    /**
     * Whatever actually went wrong underneath, when this error was raised by an
     * adapter translating a failure it did not cause — a rejected AWS SDK call,
     * a socket reset, a malformed stored record.
     *
     * Kept for the log and never for the response. `details` is what a client
     * may read; this is what an operator needs, and the two are separate fields
     * precisely so one cannot be mistaken for the other.
     */
    readonly cause?: unknown,
  ) {}
}

/**
 * Renders a cause for a log line, following the chain of nested causes.
 *
 * An adapter error usually wraps an SDK error which wraps a socket error, and
 * the sentence that explains the failure is invariably at the bottom. Printing
 * only the outermost gives "Could not read the catalogue" — true, and useless.
 *
 * The depth limit is not defensive decoration: a cause chain can be circular,
 * and a logger that follows one forever takes the process with it.
 */
export const describeCause = (cause: unknown, depth = 0): string => {
  const MAX_DEPTH = 5;

  if (cause === undefined || cause === null) {
    return '';
  }

  if (depth >= MAX_DEPTH) {
    return '... cause chain truncated';
  }

  if (cause instanceof DomainError) {
    const nested = describeCause(cause.cause, depth + 1);
    return `${cause.code}: ${cause.message}${nested === '' ? '' : `\ncaused by ${nested}`}`;
  }

  if (cause instanceof Error) {
    const nested = describeCause((cause as { cause?: unknown }).cause, depth + 1);
    const rendered = cause.stack ?? `${cause.name}: ${cause.message}`;
    return `${rendered}${nested === '' ? '' : `\ncaused by ${nested}`}`;
  }

  // A plain object stringifies to "[object Object]", which is the kind of log
  // line this function exists to stop producing. An AWS SDK error that is not
  // an Error instance still carries the name and code that identify it.
  if (typeof cause === 'object') {
    try {
      return JSON.stringify(cause);
    } catch {
      // Circular, or holding something JSON cannot represent.
      return '[cause could not be serialised]';
    }
  }

  if (typeof cause === 'string' || typeof cause === 'number' || typeof cause === 'boolean') {
    return String(cause);
  }

  return `[cause of type ${typeof cause}]`;
};

/**
 * Wraps an unexpected fault from an adapter — a rejected AWS SDK call, a socket
 * reset — so it can travel on the railway instead of escaping as an exception.
 */
export class UnexpectedFailure extends DomainError {
  readonly code = 'UNEXPECTED_FAILURE';
  readonly kind = 'UNEXPECTED' as const;

  constructor(message: string, cause?: unknown) {
    super(message, undefined, cause);
  }
}
