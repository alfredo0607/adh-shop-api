import type { Result } from './result';
import { err, ok } from './result';

/**
 * Version asincrona de `Result`, para encadenar operaciones de E/S sin
 * romper la via del ferrocarril.
 *
 * Sin este tipo, cada llamada a un repositorio obliga a un `await` seguido de
 * una guarda `if (r.isErr()) return r`, y el caso de uso se llena de ruido.
 * `ResultAsync` mantiene la composicion:
 *
 *   return this.products
 *     .findById(id)
 *     .andThen((product) => product.reserve(units))
 *     .andThen((reserved) => this.products.save(reserved));
 *
 * Implementa `PromiseLike`, asi que tambien se puede `await` directamente y
 * obtener el `Result` desnudo cuando conviene mas leerlo en estilo imperativo.
 */
export class ResultAsync<T, E> implements PromiseLike<Result<T, E>> {
  constructor(private readonly inner: Promise<Result<T, E>>) {}

  /** Envuelve una promesa que puede rechazar, traduciendo el fallo al dominio. */
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

  /** Envuelve una promesa que por contrato nunca rechaza. */
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

  /** Efecto colateral en la via feliz sin alterar el valor que circula. */
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
