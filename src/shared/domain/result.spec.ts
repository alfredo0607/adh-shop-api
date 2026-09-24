import { combine, combineAllErrors, err, ok, type Result } from './result';

describe('Result', () => {
  describe('construction and discrimination', () => {
    it('ok exposes the value and identifies itself as the happy path', () => {
      const result = ok<number, string>(42);

      expect(result.isOk()).toBe(true);
      expect(result.isErr()).toBe(false);
      if (result.isOk()) {
        expect(result.value).toBe(42);
      }
    });

    it('err exposes the error and identifies itself as the failure path', () => {
      const result = err<string, number>('out of stock');

      expect(result.isErr()).toBe(true);
      expect(result.isOk()).toBe(false);
      if (result.isErr()) {
        expect(result.error).toBe('out of stock');
      }
    });
  });

  describe('map', () => {
    it('transforms the value on the happy path', () => {
      const result = ok<number, string>(2).map((n) => n * 10);

      expect(result).toEqual(ok(20));
    });

    it('does not invoke the function on the failure path', () => {
      const fn = jest.fn((n: number) => n * 10);

      const result = err<string, number>('boom').map(fn);

      expect(fn).not.toHaveBeenCalled();
      expect(result).toEqual(err('boom'));
    });
  });

  describe('mapErr', () => {
    it('translates the error on the failure path', () => {
      const result = err<string, number>('raw').mapErr((e) => `domain:${e}`);

      expect(result).toEqual(err('domain:raw'));
    });

    it('does not invoke the function on the happy path', () => {
      const fn = jest.fn((e: string) => e.toUpperCase());

      const result = ok<number, string>(1).mapErr(fn);

      expect(fn).not.toHaveBeenCalled();
      expect(result).toEqual(ok(1));
    });
  });

  describe('andThen', () => {
    const parse = (raw: string): Result<number, string> => {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? err('not a number') : ok(parsed);
    };
    const positive = (n: number): Result<number, string> =>
      n > 0 ? ok(n) : err('must be positive');

    it('chains operations while every step succeeds', () => {
      expect(ok<string, string>('5').andThen(parse).andThen(positive)).toEqual(ok(5));
    });

    it('short-circuits on the first failure and keeps that error', () => {
      const secondStep = jest.fn(positive);

      const result = ok<string, string>('xyz').andThen(parse).andThen(secondStep);

      expect(secondStep).not.toHaveBeenCalled();
      expect(result).toEqual(err('not a number'));
    });

    it('propagates an intermediate failure without running later steps', () => {
      const result = ok<string, string>('-3').andThen(parse).andThen(positive);

      expect(result).toEqual(err('must be positive'));
    });
  });

  describe('tap', () => {
    it('runs the side effect on the happy path without altering the value', () => {
      const spy = jest.fn();

      const result = ok<number, string>(7).tap(spy);

      expect(spy).toHaveBeenCalledWith(7);
      expect(result).toEqual(ok(7));
    });

    it('skips the side effect on the failure path', () => {
      const spy = jest.fn();

      const result = err<string, number>('boom').tap(spy);

      expect(spy).not.toHaveBeenCalled();
      expect(result).toEqual(err('boom'));
    });
  });

  describe('match', () => {
    it('collapses both tracks into a single type', () => {
      const describeResult = (r: Result<number, string>): string =>
        r.match({ ok: (v) => `value ${v}`, err: (e) => `error ${e}` });

      expect(describeResult(ok(1))).toBe('value 1');
      expect(describeResult(err('x'))).toBe('error x');
    });
  });

  describe('unwrapOr', () => {
    it('returns the value on the happy path', () => {
      expect(ok<number, string>(3).unwrapOr(99)).toBe(3);
    });

    it('returns the fallback on the failure path', () => {
      expect(err<string, number>('x').unwrapOr(99)).toBe(99);
    });
  });

  describe('combine', () => {
    it('gathers the values when every result succeeds', () => {
      expect(combine([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    });

    it('stops at the first error and discards the rest', () => {
      expect(combine([ok(1), err<string, number>('a'), err<string, number>('b')])).toEqual(err('a'));
    });

    it('returns an empty list for an empty input', () => {
      expect(combine<number, string>([])).toEqual(ok([]));
    });
  });

  describe('combineAllErrors', () => {
    it('accumulates every error so they can be reported together', () => {
      const result = combineAllErrors([
        ok<number, string>(1),
        err<string, number>('invalid card'),
        err<string, number>('city is required'),
      ]);

      expect(result).toEqual(err(['invalid card', 'city is required']));
    });

    it('gathers the values when there is no error at all', () => {
      expect(combineAllErrors([ok<number, string>(1), ok<number, string>(2)])).toEqual(ok([1, 2]));
    });
  });
});
