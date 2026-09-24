import { Money } from './money';

const cop = (cents: number): Money => {
  const result = Money.create(cents, 'COP');
  if (result.isErr()) throw new Error('fixture is invalid');
  return result.value;
};

describe('Money', () => {
  describe('create', () => {
    it('holds an integer number of minor units', () => {
      const result = Money.create(150_000, 'COP');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amountInCents).toBe(150_000);
        expect(result.value.currency).toBe('COP');
      }
    });

    it('normalises the currency code', () => {
      const result = Money.create(100, 'cop');

      if (result.isOk()) {
        expect(result.value.currency).toBe('COP');
      }
    });

    it('rejects a fractional amount', () => {
      // Accepting 10.5 cents is how rounding errors enter a checkout.
      expect(Money.create(10.5, 'COP').isErr()).toBe(true);
    });

    it('rejects a negative amount', () => {
      expect(Money.create(-1, 'COP').isErr()).toBe(true);
    });

    it('allows zero, which a free delivery fee needs', () => {
      expect(Money.create(0, 'COP').isOk()).toBe(true);
    });

    it.each(['CO', 'COPS', ''])('rejects the currency code %s', (currency) => {
      expect(Money.create(100, currency).isErr()).toBe(true);
    });
  });

  describe('add', () => {
    it('sums amounts in the same currency', () => {
      const result = cop(150_000).add(cop(50_000));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amountInCents).toBe(200_000);
      }
    });

    it('is exact where floating point is not', () => {
      // 0.1 + 0.2 !== 0.3 in binary floating point. In cents it is 10 + 20.
      const result = cop(10).add(cop(20));

      if (result.isOk()) {
        expect(result.value.amountInCents).toBe(30);
      }
    });

    it('refuses to add different currencies instead of coercing them', () => {
      const usd = Money.create(100, 'USD');
      if (usd.isErr()) throw new Error('fixture is invalid');

      const result = cop(100).add(usd.value);

      expect(result.isErr()).toBe(true);
    });
  });

  describe('multiply', () => {
    it('scales by a unit count', () => {
      const result = cop(150_000).multiply(3);

      if (result.isOk()) {
        expect(result.value.amountInCents).toBe(450_000);
      }
    });

    it('rejects a fractional or negative factor', () => {
      expect(cop(100).multiply(1.5).isErr()).toBe(true);
      expect(cop(100).multiply(-1).isErr()).toBe(true);
    });

    it('allows zero', () => {
      const result = cop(100).multiply(0);

      if (result.isOk()) {
        expect(result.value.amountInCents).toBe(0);
      }
    });
  });

  describe('equals', () => {
    it('compares amount and currency together', () => {
      const usd = Money.create(100, 'USD');
      if (usd.isErr()) throw new Error('fixture is invalid');

      expect(cop(100).equals(cop(100))).toBe(true);
      expect(cop(100).equals(cop(200))).toBe(false);
      expect(cop(100).equals(usd.value)).toBe(false);
    });
  });
});
