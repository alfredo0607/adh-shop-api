import type { Result } from './result';
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

  map<U>(fn: (value: T) => U | Promise<U>): ResultAsync<U, E> {
    return new ResultAsync<U, E>(
      this.inner.then(async (result) =>
        result.isErr() ? err<E, U>(result.error) : ok<U, E>(await fn(result.value)),
      ),
    );
  }

  mapErr<F>(fn: (error: E) => F | Promise<F>): ResultAsync<T, F> {
    return new ResultAsync<T, F>(
      this.inner.then(async (result) =>
        result.isOk() ? ok<T, F>(result.value) : err<F, T>(await fn(result.error)),
      ),
    );
  }

  andThen<U, F>(
    fn: (value: T) => Result<U, F> | ResultAsync<U, F> | Promise<Result<U, F>>,
  ): ResultAsync<U, E | F> {
    return new ResultAsync<U, E | F>(
      this.inner.then(async (result) =>
        result.isErr() ? err<E | F, U>(result.error) : await fn(result.value),
      ),
    );
  }

  /** Side effect on the happy path without altering the value in flight. */
  tap(fn: (value: T) => void | Promise<void>): ResultAsync<T, E> {
    return new ResultAsync<T, E>(
      this.inner.then(async (result) => {
        if (result.isOk()) {
          await fn(result.value);
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
