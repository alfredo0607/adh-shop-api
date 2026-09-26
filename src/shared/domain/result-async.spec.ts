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

  describe('combine', () => {
    it('collects every value, in the order given', async () => {
      const result = await ResultAsync.combine([ResultAsync.ok(1), ResultAsync.ok(2)]);

      expect(result).toEqual(ok([1, 2]));
    });

    it('reports the first failure in list order, whichever finishes first', async () => {
      const slowFailure = new ResultAsync<number, string>(
        new Promise((resolve) => setTimeout(() => resolve(err('first')), 10)),
      );

      const result = await ResultAsync.combine([
        ResultAsync.ok<number, string>(1),
        slowFailure,
        ResultAsync.err<string, number>('second'),
      ]);

      expect(result).toEqual(err('first'));
    });

    it('succeeds with nothing to combine', async () => {
      expect(await ResultAsync.combine([])).toEqual(ok([]));
    });
  });

  describe('map', () => {
    it('transforms the value on the happy path', async () => {
      const result = await ResultAsync.ok<number, string>(3).map((n) => n * 2);

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
      const result = await ResultAsync.ok<number, string>(4).andThen((n) =>
        ok<number, string>(n + 1),
      );

      expect(result).toEqual(ok(5));
    });

    it('chains another ResultAsync', async () => {
      const result = await ResultAsync.ok<number, string>(4).andThen((n) =>
        ResultAsync.ok<number, string>(n * 3),
      );

      expect(result).toEqual(ok(12));
    });

    it('chains asynchronous work admitted through fromPromise', async () => {
      const result = await ResultAsync.ok<number, string>(4).andThen((n) =>
        ResultAsync.fromPromise(Promise.resolve(n - 1), () => 'unreachable'),
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

  describe('orElse', () => {
    it('leaves the happy path untouched and never runs the handler', async () => {
      const handler = jest.fn();

      const result = await ResultAsync.ok<number, string>(1).orElse(handler);

      expect(handler).not.toHaveBeenCalled();
      expect(result).toEqual(ok(1));
    });

    it('can recover from a failure', async () => {
      const result = await ResultAsync.err<string, number>('cache miss').orElse(() => ok(0));

      expect(result).toEqual(ok(0));
    });

    it('can run an asynchronous compensation and still report the original failure', async () => {
      const undo = jest.fn(() => ResultAsync.ok<void, string>(undefined));

      const result = await ResultAsync.err<string, number>('write failed').orElse((error) =>
        undo().andThen(() => err<string, number>(error)),
      );

      expect(undo).toHaveBeenCalledTimes(1);
      expect(result).toEqual(err('write failed'));
    });
  });

  describe('tap', () => {
    it('runs the effect on the happy path without altering the value', async () => {
      const spy = jest.fn();

      const result = await ResultAsync.ok<number, string>(9).tap(spy);

      expect(spy).toHaveBeenCalledWith(9);
      expect(result).toEqual(ok(9));
    });

    it('runs the effect before the next step in the chain', async () => {
      const order: string[] = [];

      await ResultAsync.ok<number, string>(1)
        .tap(() => order.push('effect'))
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

  describe('defect boundary', () => {
    // These assertions are enforced by the compiler, not at runtime. Each
    // `@ts-expect-error` fails the build if the line below it ever stops being a
    // type error — that is, if the unsafe path is ever reopened. Narrowing these
    // signatures is what keeps a rejected promise from escaping the railway and
    // surfacing as an HTTP 500 instead of a typed domain error.

    it('refuses an async function in map, because asynchronous work is I/O', () => {
      const chain = ResultAsync.ok<number, string>(1);

      // @ts-expect-error map is synchronous: I/O must enter through fromPromise
      void chain.map(async (n) => {
        await Promise.resolve();
        return n * 2;
      });

      expect(chain).toBeInstanceOf(ResultAsync);
    });

    it('refuses a bare promise of Result in andThen, because a promise can reject', () => {
      const chain = ResultAsync.ok<number, string>(1);

      // @ts-expect-error andThen accepts Result or ResultAsync, never a raw promise
      void chain.andThen((n) => Promise.resolve(ok<number, string>(n)));

      expect(chain).toBeInstanceOf(ResultAsync);
    });

    it('refuses an async side effect in tap, which belongs in andThen', () => {
      const chain = ResultAsync.ok<number, string>(1);

      // @ts-expect-error tap is synchronous: a failing side effect belongs in the chain
      void chain.tap(async () => {
        await Promise.resolve();
      });

      expect(chain).toBeInstanceOf(ResultAsync);
    });

    it('admits a rejecting promise through fromPromise, translating it to an Err', () => {
      const chain = ResultAsync.fromPromise(
        Promise.reject(new Error('ECONNRESET')),
        (cause) => `gateway unreachable: ${String(cause)}`,
      );

      return expect(chain).resolves.toEqual(err('gateway unreachable: Error: ECONNRESET'));
    });
  });
});
