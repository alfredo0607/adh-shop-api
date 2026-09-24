import { Stock } from './stock';

const stockOf = (available: number, reserved = 0): Stock => {
  const result = Stock.create(available, reserved);
  if (result.isErr()) {
    throw new Error('fixture is invalid');
  }
  return result.value;
};

describe('Stock', () => {
  describe('create', () => {
    it('accepts non-negative integer counts', () => {
      const result = Stock.create(10, 2);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.available).toBe(10);
        expect(result.value.reserved).toBe(2);
        expect(result.value.total).toBe(12);
      }
    });

    it.each([
      ['negative available', -1, 0],
      ['negative reserved', 0, -1],
      ['fractional available', 1.5, 0],
    ])('rejects %s', (_label, available, reserved) => {
      expect(Stock.create(available, reserved).isErr()).toBe(true);
    });

    it('reports sold out only when nothing is available', () => {
      expect(stockOf(0, 5).isSoldOut).toBe(true);
      expect(stockOf(1, 0).isSoldOut).toBe(false);
    });
  });

  describe('reserve', () => {
    it('moves units from available to reserved without changing the total', () => {
      const result = stockOf(10).reserve(3);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.available).toBe(7);
        expect(result.value.reserved).toBe(3);
        expect(result.value.total).toBe(10);
      }
    });

    it('allows reserving every remaining unit', () => {
      const result = stockOf(4).reserve(4);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.isSoldOut).toBe(true);
      }
    });

    it('refuses to reserve more than is available, rather than clamping', () => {
      const result = stockOf(2).reserve(5);

      // Silently reserving 2 would let a customer pay for five and receive two.
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('INSUFFICIENT_STOCK');
        expect(result.error.details).toEqual({ requested: 5, available: 2 });
      }
    });

    it('does not consider reserved units to be available', () => {
      // 3 already held for other checkouts, so only 2 can be sold.
      const result = stockOf(2, 3).reserve(4);

      expect(result.isErr()).toBe(true);
    });

    it.each([0, -1, 1.5])('rejects a unit count of %s', (units) => {
      expect(stockOf(10).reserve(units).isErr()).toBe(true);
    });

    it('leaves the original untouched, since a transition returns a new value', () => {
      const original = stockOf(10);

      original.reserve(3);

      expect(original.available).toBe(10);
    });
  });

  describe('confirm', () => {
    it('removes the units from the product entirely', () => {
      const result = stockOf(7, 3).confirm(3);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.available).toBe(7);
        expect(result.value.reserved).toBe(0);
        expect(result.value.total).toBe(7);
      }
    });

    it('refuses to confirm more than is held', () => {
      // Without this guard a repeated confirmation drives reserved negative,
      // quietly manufacturing stock that never existed.
      const result = stockOf(7, 2).confirm(3);

      expect(result.isErr()).toBe(true);
    });

    it('refuses a second confirmation of the same reservation', () => {
      const first = stockOf(7, 3).confirm(3);
      if (first.isErr()) {
        throw new Error('first confirmation should succeed');
      }

      expect(first.value.confirm(3).isErr()).toBe(true);
    });
  });

  describe('release', () => {
    it('returns held units to the shelf', () => {
      const result = stockOf(7, 3).release(3);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.available).toBe(10);
        expect(result.value.reserved).toBe(0);
        expect(result.value.total).toBe(10);
      }
    });

    it('refuses to release more than is held', () => {
      expect(stockOf(7, 2).release(3).isErr()).toBe(true);
    });
  });

  describe('the full lifecycle', () => {
    it('conserves units through reserve and release', () => {
      const start = stockOf(10);

      const reserved = start.reserve(4);
      if (reserved.isErr()) throw new Error('reserve failed');
      const released = reserved.value.release(4);
      if (released.isErr()) throw new Error('release failed');

      // A declined payment must leave the shelf exactly as it was found.
      expect(released.value.available).toBe(10);
      expect(released.value.reserved).toBe(0);
    });

    it('removes exactly the sold units through reserve and confirm', () => {
      const start = stockOf(10);

      const reserved = start.reserve(4);
      if (reserved.isErr()) throw new Error('reserve failed');
      const confirmed = reserved.value.confirm(4);
      if (confirmed.isErr()) throw new Error('confirm failed');

      expect(confirmed.value.available).toBe(6);
      expect(confirmed.value.reserved).toBe(0);
      expect(confirmed.value.total).toBe(6);
    });

    it('never lets the counts go negative across an interleaved sequence', () => {
      let stock = stockOf(3);
      const steps: Array<() => void> = [
        (): void => {
          const r = stock.reserve(2);
          if (r.isOk()) stock = r.value;
        },
        (): void => {
          const r = stock.confirm(1);
          if (r.isOk()) stock = r.value;
        },
        (): void => {
          const r = stock.release(5);
          if (r.isOk()) stock = r.value;
        },
        (): void => {
          const r = stock.reserve(10);
          if (r.isOk()) stock = r.value;
        },
      ];

      for (const step of steps) {
        step();
        expect(stock.available).toBeGreaterThanOrEqual(0);
        expect(stock.reserved).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
