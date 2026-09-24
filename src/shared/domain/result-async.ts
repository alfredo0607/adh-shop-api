import type { NotPromise, Result } from './result';
import { err, ok } from './result';

/**
 * Asynchronous counterpart of `Result`, for chaining I/O without breaking
 * off the railway track.
 *
 * Without this type every repository call needs an `await` followed by an
 * `if (r.isErr()) return r` guard, and the use case fills up with noise.
 * `ResultAsync` preserves composition:
 *
 *   return this.products
 *     .findById(id)
 *     .andThen((product) => product.reserve(units))
 *     .andThen((reserved) => this.products.save(reserved));
 *
 * It implements `PromiseLike`, so a chain can also be awaited directly to get
 * the bare `Result` where imperative style reads better.
 */
export class ResultAsync<T, E> implements PromiseLike<Result<T, E>> {
  constructor(private readonly inner: Promise<Result<T, E>>) {}

  /** Wraps a promise that may reject, translating the failure into the domain. */
  static fromPromise<T, E>(
    promise: Promise<T>,
    onRejected: (reason: unknown) => E,
  ): ResultAsync<T, E> {
    return new ResultAsync<T, E>(
      promise.then(
        (value) => ok<T, E>(value),
        (reason: unknown) => err<E, T>(onRejected(reason)),
      ),
    );
  }

  /** Wraps a promise that by contract never rejects. */
  static fromSafePromise<T, E = never>(promise: Promise<T>): ResultAsync<T, E> {
    return new ResultAsync<T, E>(promise.then((value) => ok<T, E>(value)));
  }

  static fromResult<T, E>(result: Result<T, E>): ResultAsync<T, E> {
    return new ResultAsync<T, E>(Promise.resolve(result));
  }

  static ok<T, E = never>(value: T): ResultAsync<T, E> {
    return new ResultAsync<T, E>(Promise.resolve(ok<T, E>(value)));
  }

  static err<E, T = never>(error: E): ResultAsync<T, E> {
    return new ResultAsync<T, E>(Promise.resolve(err<E, T>(error)));
  }

  /**
   * Transforms the value on the happy path.
   *
   * `fn` is deliberately synchronous. An asynchronous transformation is I/O, and
   * all I/O must enter the railway through `fromPromise` so that its failure is
   * translated into a domain error at the point it happens. Accepting an async
   * `fn` here would let a rejection escape the chain unnoticed.
   */
  map<U>(fn: (value: T) => U & NotPromise<U>): ResultAsync<U, E> {
    return new ResultAsync<U, E>(
      this.inner.then((result) =>
        result.isErr() ? err<E, U>(result.error) : ok<U, E>(fn(result.value)),
      ),
    );
  }

  mapErr<F>(fn: (error: E) => F & NotPromise<F>): ResultAsync<T, F> {
    return new ResultAsync<T, F>(
      this.inner.then((result) =>
        result.isOk() ? ok<T, F>(result.value) : err<F, T>(fn(result.error)),
      ),
    );
  }

  /**
   * Chains an operation that may also fail.
   *
   * Accepts `Result` and `ResultAsync`, but not a bare `Promise<Result>`: a
   * promise can reject, and a rejection would bypass the railway. A repository
   * returning `ResultAsync` has already been through `fromPromise`, which forces
   * its failure mode to be declared.
   */
  andThen<U, F>(fn: (value: T) => Result<U, F> | ResultAsync<U, F>): ResultAsync<U, E | F> {
    return new ResultAsync<U, E | F>(
      this.inner.then(async (result) =>
        result.isErr() ? err<E | F, U>(result.error) : await fn(result.value),
      ),
    );
  }

  /**
   * Side effect on the happy path without altering the value in flight.
   *
   * Synchronous for the same reason as `map`. An asynchronous side effect is I/O
   * and belongs in `andThen`, where its failure is part of the chain.
   */
  tap<R>(fn: (value: T) => R & NotPromise<R>): ResultAsync<T, E> {
    return new ResultAsync<T, E>(
      this.inner.then((result) => {
        if (result.isOk()) {
          fn(result.value);
        }
        return result;
      }),
    );
  }

  match<A>(handlers: { ok: (value: T) => A; err: (error: E) => A }): Promise<A> {
    return this.inner.then((result) => result.match(handlers));
  }

  then<A = Result<T, E>, B = never>(
    onfulfilled?: ((value: Result<T, E>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.inner.then(onfulfilled, onrejected);
  }
}
