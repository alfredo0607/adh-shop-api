/**
 * Result<T, E> is the core type of Railway Oriented Programming.
 *
 * A use case returns `Result` rather than throwing: the success and failure
 * paths travel through the same signature and the compiler forces both to be
 * handled. Exceptions stay reserved for genuinely unexpected faults (bugs),
 * not for business rules.
 *
 * This module lives in the domain layer and therefore has no external
 * dependencies. That is deliberate: the core knows nothing about frameworks.
 */

export type Result<T, E> = Ok<T, E> | Err<T, E>;

export class Ok<T, E> {
  readonly _tag = 'Ok' as const;

  constructor(readonly value: T) {}

  isOk(): this is Ok<T, E> {
    return true;
  }

  isErr(): this is Err<T, E> {
    return false;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok<U, E>(fn(this.value));
  }

  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return new Ok<T, F>(this.value);
  }

  /** The railway switch: chains an operation that may also fail. */
  andThen<U, F>(fn: (value: T) => Result<U, F>): Result<U, E | F> {
    return fn(this.value);
  }

  /** Runs a side effect without altering the track. */
  tap(fn: (value: T) => void): Result<T, E> {
    fn(this.value);
    return this;
  }

  match<A>(handlers: { ok: (value: T) => A; err: (error: E) => A }): A {
    return handlers.ok(this.value);
  }

  unwrapOr(_fallback: T): T {
    return this.value;
  }
}

export class Err<T, E> {
  readonly _tag = 'Err' as const;

  constructor(readonly error: E) {}

  isOk(): this is Ok<T, E> {
    return false;
  }

  isErr(): this is Err<T, E> {
    return true;
  }

  map<U>(_fn: (value: T) => U): Result<U, E> {
    return new Err<U, E>(this.error);
  }

  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err<T, F>(fn(this.error));
  }

  andThen<U, F>(_fn: (value: T) => Result<U, F>): Result<U, E | F> {
    return new Err<U, E | F>(this.error);
  }

  tap(_fn: (value: T) => void): Result<T, E> {
    return this;
  }

  match<A>(handlers: { ok: (value: T) => A; err: (error: E) => A }): A {
    return handlers.err(this.error);
  }

  unwrapOr(fallback: T): T {
    return fallback;
  }
}

export const ok = <T, E = never>(value: T): Result<T, E> => new Ok<T, E>(value);

export const err = <E, T = never>(error: E): Result<T, E> => new Err<T, E>(error);

/**
 * Collapses a list of results into a result of list.
 * Stops at the first error, which is what chained preconditions need.
 */
export const combine = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (result.isErr()) {
      return new Err<T[], E>(result.error);
    }
    values.push(result.value);
  }
  return new Ok<T[], E>(values);
};

/**
 * Like `combine`, but accumulates every error instead of stopping at the
 * first one. This is what form validation needs: the client deserves to see
 * all invalid fields at once rather than discovering them one at a time.
 */
export const combineAllErrors = <T, E>(results: readonly Result<T, E>[]): Result<T[], E[]> => {
  const values: T[] = [];
  const errors: E[] = [];

  for (const result of results) {
    if (result.isErr()) {
      errors.push(result.error);
    } else {
      values.push(result.value);
    }
  }

  return errors.length > 0 ? new Err<T[], E[]>(errors) : new Ok<T[], E[]>(values);
};
