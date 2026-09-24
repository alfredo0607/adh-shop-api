import { combine, combineAllErrors, err, ok, type Result } from './result';

describe('Result', () => {
  describe('construccion y discriminacion', () => {
    it('ok expone el valor y se identifica como via feliz', () => {
      const result = ok<number, string>(42);

      expect(result.isOk()).toBe(true);
      expect(result.isErr()).toBe(false);
      if (result.isOk()) {
        expect(result.value).toBe(42);
      }
    });

    it('err expone el error y se identifica como via de fallo', () => {
      const result = err<string, number>('sin stock');

      expect(result.isErr()).toBe(true);
      expect(result.isOk()).toBe(false);
      if (result.isErr()) {
        expect(result.error).toBe('sin stock');
      }
    });
  });

  describe('map', () => {
    it('transforma el valor cuando la via es feliz', () => {
      const result = ok<number, string>(2).map((n) => n * 10);

      expect(result).toEqual(ok(20));
    });

    it('no invoca la funcion cuando la via es de fallo', () => {
      const fn = jest.fn((n: number) => n * 10);

      const result = err<string, number>('boom').map(fn);

      expect(fn).not.toHaveBeenCalled();
      expect(result).toEqual(err('boom'));
    });
  });

  describe('mapErr', () => {
    it('traduce el error cuando la via es de fallo', () => {
      const result = err<string, number>('raw').mapErr((e) => `dominio:${e}`);

      expect(result).toEqual(err('dominio:raw'));
    });

    it('no invoca la funcion cuando la via es feliz', () => {
      const fn = jest.fn((e: string) => e.toUpperCase());

      const result = ok<number, string>(1).mapErr(fn);

      expect(fn).not.toHaveBeenCalled();
      expect(result).toEqual(ok(1));
    });
  });

  describe('andThen', () => {
    const parse = (raw: string): Result<number, string> => {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? err('no es un numero') : ok(parsed);
    };
    const positive = (n: number): Result<number, string> =>
      n > 0 ? ok(n) : err('debe ser positivo');

    it('encadena operaciones mientras todas tengan exito', () => {
      expect(ok<string, string>('5').andThen(parse).andThen(positive)).toEqual(ok(5));
    });

    it('cortocircuita en el primer fallo y conserva ese error', () => {
      const secondStep = jest.fn(positive);

      const result = ok<string, string>('xyz').andThen(parse).andThen(secondStep);

      expect(secondStep).not.toHaveBeenCalled();
      expect(result).toEqual(err('no es un numero'));
    });

    it('propaga el fallo de un paso intermedio sin ejecutar los siguientes', () => {
      const result = ok<string, string>('-3').andThen(parse).andThen(positive);

      expect(result).toEqual(err('debe ser positivo'));
    });
  });

  describe('tap', () => {
    it('ejecuta el efecto colateral en la via feliz sin alterar el valor', () => {
      const spy = jest.fn();

      const result = ok<number, string>(7).tap(spy);

      expect(spy).toHaveBeenCalledWith(7);
      expect(result).toEqual(ok(7));
    });

    it('omite el efecto colateral en la via de fallo', () => {
      const spy = jest.fn();

      const result = err<string, number>('boom').tap(spy);

      expect(spy).not.toHaveBeenCalled();
      expect(result).toEqual(err('boom'));
    });
  });

  describe('match', () => {
    it('colapsa ambas vias a un unico tipo', () => {
      const describe_ = (r: Result<number, string>): string =>
        r.match({ ok: (v) => `valor ${v}`, err: (e) => `error ${e}` });

      expect(describe_(ok(1))).toBe('valor 1');
      expect(describe_(err('x'))).toBe('error x');
    });
  });

  describe('unwrapOr', () => {
    it('devuelve el valor en la via feliz', () => {
      expect(ok<number, string>(3).unwrapOr(99)).toBe(3);
    });

    it('devuelve el sustituto en la via de fallo', () => {
      expect(err<string, number>('x').unwrapOr(99)).toBe(99);
    });
  });

  describe('combine', () => {
    it('agrupa los valores cuando todos tienen exito', () => {
      expect(combine([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    });

    it('corta en el primer error y descarta el resto', () => {
      expect(combine([ok(1), err<string, number>('a'), err<string, number>('b')])).toEqual(err('a'));
    });

    it('devuelve una lista vacia para una entrada vacia', () => {
      expect(combine<number, string>([])).toEqual(ok([]));
    });
  });

  describe('combineAllErrors', () => {
    it('acumula todos los errores para poder reportarlos juntos', () => {
      const result = combineAllErrors([
        ok<number, string>(1),
        err<string, number>('tarjeta invalida'),
        err<string, number>('ciudad requerida'),
      ]);

      expect(result).toEqual(err(['tarjeta invalida', 'ciudad requerida']));
    });

    it('agrupa los valores cuando no hay ningun error', () => {
      expect(combineAllErrors([ok<number, string>(1), ok<number, string>(2)])).toEqual(ok([1, 2]));
    });
  });
});
