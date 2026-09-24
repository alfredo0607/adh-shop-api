import { ResultAsync } from './result-async';
import { err, ok, type Result } from './result';

describe('ResultAsync', () => {
  describe('constructors', () => {
    it('fromPromise translates a rejection into the language of the domain', async () => {
      const source = Promise.reject(new Error('ECONNREFUSED'));

      const result = await ResultAsync.fromPromise(source, () => 'payment gateway unavailable');

      expect(result).toEqual(err('payment gateway unavailable'));
    });

    it('fromPromise yields the value when the promise resolves', async () => {
      const result = await ResultAsync.fromPromise(Promise.resolve(10), () => 'never');

      expect(result).toEqual(ok(10));
    });

    it('fromPromise receives the original rejection reason', async () => {
      const cause = new Error('timed out after 5000ms');
      const onRejected = jest.fn(() => 'translated');

      await ResultAsync.fromPromise(Promise.reject(cause), onRejected);

      expect(onRejected).toHaveBeenCalledWith(cause);
    });

    it('fromSafePromise wraps a promise that never rejects', async () => {
      expect(await ResultAsync.fromSafePromise(Promise.resolve('ok'))).toEqual(ok('ok'));
    });

    it('fromResult lifts a synchronous Result', async () => {
      expect(await ResultAsync.fromResult(ok<number, string>(1))).toEqual(ok(1));
    });

    it('ok and err build each track directly', async () => {
      expect(await ResultAsync.ok<number, string>(5)).toEqual(ok(5));
      expect(await ResultAsync.err<string, number>('x')).toEqual(err('x'));
    });
  });

  describe('map', () => {
    it('transforms the value and accepts asynchronous functions', async () => {
      const result = await ResultAsync.ok<number, string>(3).map(async (n) => {
        await Promise.resolve();
        return n * 2;
      });

      expect(result).toEqual(ok(6));
    });

    it('does not invoke the function on the failure path', async () => {
      const fn = jest.fn((n: number) => n * 2);

      const result = await ResultAsync.err<string, number>('boom').map(fn);

      expect(fn).not.toHaveBeenCalled();
      expect(result).toEqual(err('boom'));
    });
  });

  describe('mapErr', () => {
    it('translates the error on the failure path', async () => {
      const result = await ResultAsync.err<string, number>('raw').mapErr((e) => `domain:${e}`);

      expect(result).toEqual(err('domain:raw'));
    });

    it('does not invoke the function on the happy path', async () => {
      const fn = jest.fn((e: string) => e);

      const result = await ResultAsync.ok<number, string>(1).mapErr(fn);

      expect(fn).not.toHaveBeenCalled();
      expect(result).toEqual(ok(1));
    });
  });

  describe('andThen', () => {
    it('chains a synchronous Result', async () => {
      const result = await ResultAsync.ok<number, string>(4).andThen((n) => ok<number, string>(n + 1));

      expect(result).toEqual(ok(5));
    });

    it('chains another ResultAsync', async () => {
      const result = await ResultAsync.ok<number, string>(4).andThen((n) =>
        ResultAsync.ok<number, string>(n * 3),
      );

      expect(result).toEqual(ok(12));
    });

    it('chains a promise of Result', async () => {
      const result = await ResultAsync.ok<number, string>(4).andThen((n) =>
        Promise.resolve(ok<number, string>(n - 1)),
      );

      expect(result).toEqual(ok(3));
    });

    it('short-circuits: steps after a failure never run', async () => {
      const reserveStock = jest.fn(() => ResultAsync.ok<string, string>('reserved'));
      const charge = jest.fn(() => ResultAsync.ok<string, string>('charged'));

      const result = await ResultAsync.err<string, string>('product does not exist')
        .andThen(reserveStock)
        .andThen(charge);

      expect(reserveStock).not.toHaveBeenCalled();
      expect(charge).not.toHaveBeenCalled();
      expect(result).toEqual(err('product does not exist'));
    });

    it('halts the chain at the exact point where the failure appears', async () => {
      const charge = jest.fn(() => ResultAsync.ok<string, string>('charged'));

      const result = await ResultAsync.ok<number, string>(1)
        .andThen(() => ResultAsync.err<string, string>('out of stock'))
        .andThen(charge);

      expect(charge).not.toHaveBeenCalled();
      expect(result).toEqual(err('out of stock'));
    });
  });

  describe('tap', () => {
    it('runs the effect on the happy path without altering the value', async () => {
      const spy = jest.fn();

      const result = await ResultAsync.ok<number, string>(9).tap(spy);

      expect(spy).toHaveBeenCalledWith(9);
      expect(result).toEqual(ok(9));
    });

    it('awaits an asynchronous effect before continuing', async () => {
      const order: string[] = [];

      await ResultAsync.ok<number, string>(1)
        .tap(async () => {
          await Promise.resolve();
          order.push('effect');
        })
        .map(() => order.push('next'));

      expect(order).toEqual(['effect', 'next']);
    });

    it('skips the effect on the failure path', async () => {
      const spy = jest.fn();

      const result = await ResultAsync.err<string, number>('boom').tap(spy);

      expect(spy).not.toHaveBeenCalled();
      expect(result).toEqual(err('boom'));
    });
  });

  describe('match', () => {
    it('collapses both tracks into a single type', async () => {
      const toHttp = (r: ResultAsync<number, string>): Promise<number> =>
        r.match({ ok: () => 200, err: () => 409 });

      expect(await toHttp(ResultAsync.ok(1))).toBe(200);
      expect(await toHttp(ResultAsync.err('out of stock'))).toBe(409);
    });
  });

  describe('interoperability with await', () => {
    it('is PromiseLike, so it can be awaited and read imperatively', async () => {
      const result: Result<number, string> = await ResultAsync.ok<number, string>(1);

      expect(result.isOk()).toBe(true);
    });
  });
});
