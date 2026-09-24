import { ResultAsync } from './result-async';
import { err, ok, type Result } from './result';

describe('ResultAsync', () => {
  describe('constructores', () => {
    it('fromPromise traduce un rechazo al lenguaje del dominio', async () => {
      const source = Promise.reject(new Error('ECONNREFUSED'));

      const result = await ResultAsync.fromPromise(source, () => 'pasarela no disponible');

      expect(result).toEqual(err('pasarela no disponible'));
    });

    it('fromPromise entrega el valor cuando la promesa resuelve', async () => {
      const result = await ResultAsync.fromPromise(Promise.resolve(10), () => 'nunca');

      expect(result).toEqual(ok(10));
    });

    it('fromPromise recibe la razon original del rechazo', async () => {
      const cause = new Error('timeout tras 5000ms');
      const onRejected = jest.fn(() => 'traducido');

      await ResultAsync.fromPromise(Promise.reject(cause), onRejected);

      expect(onRejected).toHaveBeenCalledWith(cause);
    });

    it('fromSafePromise envuelve una promesa que no rechaza', async () => {
      expect(await ResultAsync.fromSafePromise(Promise.resolve('ok'))).toEqual(ok('ok'));
    });

    it('fromResult eleva un Result sincrono', async () => {
      expect(await ResultAsync.fromResult(ok<number, string>(1))).toEqual(ok(1));
    });

    it('ok y err construyen directamente cada via', async () => {
      expect(await ResultAsync.ok<number, string>(5)).toEqual(ok(5));
      expect(await ResultAsync.err<string, number>('x')).toEqual(err('x'));
    });
  });

  describe('map', () => {
    it('transforma el valor y admite funciones asincronas', async () => {
      const result = await ResultAsync.ok<number, string>(3).map(async (n) => n * 2);

      expect(result).toEqual(ok(6));
    });

    it('no invoca la funcion en la via de fallo', async () => {
      const fn = jest.fn((n: number) => n * 2);

      const result = await ResultAsync.err<string, number>('boom').map(fn);

      expect(fn).not.toHaveBeenCalled();
      expect(result).toEqual(err('boom'));
    });
  });

  describe('mapErr', () => {
    it('traduce el error en la via de fallo', async () => {
      const result = await ResultAsync.err<string, number>('raw').mapErr((e) => `dominio:${e}`);

      expect(result).toEqual(err('dominio:raw'));
    });

    it('no invoca la funcion en la via feliz', async () => {
      const fn = jest.fn((e: string) => e);

      const result = await ResultAsync.ok<number, string>(1).mapErr(fn);

      expect(fn).not.toHaveBeenCalled();
      expect(result).toEqual(ok(1));
    });
  });

  describe('andThen', () => {
    it('encadena un Result sincrono', async () => {
      const result = await ResultAsync.ok<number, string>(4).andThen((n) => ok<number, string>(n + 1));

      expect(result).toEqual(ok(5));
    });

    it('encadena otro ResultAsync', async () => {
      const result = await ResultAsync.ok<number, string>(4).andThen((n) =>
        ResultAsync.ok<number, string>(n * 3),
      );

      expect(result).toEqual(ok(12));
    });

    it('encadena una promesa de Result', async () => {
      const result = await ResultAsync.ok<number, string>(4).andThen((n) =>
        Promise.resolve(ok<number, string>(n - 1)),
      );

      expect(result).toEqual(ok(3));
    });

    it('cortocircuita: los pasos posteriores a un fallo no llegan a ejecutarse', async () => {
      const reservarStock = jest.fn(() => ResultAsync.ok<string, string>('reservado'));
      const cobrar = jest.fn(() => ResultAsync.ok<string, string>('cobrado'));

      const result = await ResultAsync.err<string, string>('producto inexistente')
        .andThen(reservarStock)
        .andThen(cobrar);

      expect(reservarStock).not.toHaveBeenCalled();
      expect(cobrar).not.toHaveBeenCalled();
      expect(result).toEqual(err('producto inexistente'));
    });

    it('detiene la cadena en el punto exacto donde aparece el fallo', async () => {
      const cobrar = jest.fn(() => ResultAsync.ok<string, string>('cobrado'));

      const result = await ResultAsync.ok<number, string>(1)
        .andThen(() => ResultAsync.err<string, string>('sin stock'))
        .andThen(cobrar);

      expect(cobrar).not.toHaveBeenCalled();
      expect(result).toEqual(err('sin stock'));
    });
  });

  describe('tap', () => {
    it('ejecuta el efecto en la via feliz sin alterar el valor', async () => {
      const spy = jest.fn();

      const result = await ResultAsync.ok<number, string>(9).tap(spy);

      expect(spy).toHaveBeenCalledWith(9);
      expect(result).toEqual(ok(9));
    });

    it('espera a un efecto asincrono antes de continuar', async () => {
      const orden: string[] = [];

      await ResultAsync.ok<number, string>(1)
        .tap(async () => {
          await Promise.resolve();
          orden.push('efecto');
        })
        .map(() => orden.push('siguiente'));

      expect(orden).toEqual(['efecto', 'siguiente']);
    });

    it('omite el efecto en la via de fallo', async () => {
      const spy = jest.fn();

      const result = await ResultAsync.err<string, number>('boom').tap(spy);

      expect(spy).not.toHaveBeenCalled();
      expect(result).toEqual(err('boom'));
    });
  });

  describe('match', () => {
    it('colapsa ambas vias a un unico tipo', async () => {
      const toHttp = (r: ResultAsync<number, string>): Promise<number> =>
        r.match({ ok: () => 200, err: () => 409 });

      expect(await toHttp(ResultAsync.ok(1))).toBe(200);
      expect(await toHttp(ResultAsync.err('sin stock'))).toBe(409);
    });
  });

  describe('interoperabilidad con await', () => {
    it('es PromiseLike, de modo que se puede await y leer en estilo imperativo', async () => {
      const result: Result<number, string> = await ResultAsync.ok<number, string>(1);

      expect(result.isOk()).toBe(true);
    });
  });
});
