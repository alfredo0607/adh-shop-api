/**
 * Result<T, E> es el tipo central de Railway Oriented Programming.
 *
 * Un caso de uso devuelve `Result` en lugar de lanzar excepciones: el camino
 * feliz y el de error viajan por la misma firma, y el compilador obliga a
 * tratar ambos. Las excepciones quedan reservadas para fallos realmente
 * inesperados (bugs), no para reglas de negocio.
 *
 * Este modulo vive en la capa de dominio y por tanto no tiene ninguna
 * dependencia externa: es deliberado, el nucleo no conoce frameworks.
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

  /** El desvio de la via: encadena una operacion que tambien puede fallar. */
  andThen<U, F>(fn: (value: T) => Result<U, F>): Result<U, E | F> {
    return fn(this.value);
  }

  /** Ejecuta un efecto colateral sin alterar la via. */
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
 * Colapsa una lista de resultados en un resultado de lista.
 * Corta en el primer error: util para precondiciones encadenadas.
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
 * Como `combine`, pero acumula todos los errores en lugar de cortar en el
 * primero. Es lo que queremos al validar un formulario: el cliente merece
 * ver de una vez todos los campos invalidos, no descubrirlos de uno en uno.
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
