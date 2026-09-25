import { Quote } from './quote';

describe('Quote', () => {
  const fees = { baseFeeInCents: 500_00, deliveryFeeInCents: 1_200_00 };

  it('adds the product amount and both fees, in whole cents', () => {
    const result = Quote.calculate({
      unitPriceInCents: 89_990_00,
      units: 2,
      currency: 'COP',
      fees,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.productInCents).toBe(179_980_00);
    expect(result.value.totalInCents).toBe(179_980_00 + 500_00 + 1_200_00);
    expect(Number.isInteger(result.value.totalInCents)).toBe(true);
  });

  it.each([0, -1, 1.5, 11])('rejects %p units', (units) => {
    const result = Quote.calculate({ unitPriceInCents: 100, units, currency: 'COP', fees });

    expect(result.isErr() && result.error.code).toBe('INVALID_TRANSACTION');
  });

  it('rejects a fractional or negative amount, which would mean a pricing defect', () => {
    expect(
      Quote.calculate({ unitPriceInCents: 10.5, units: 1, currency: 'COP', fees }).isErr(),
    ).toBe(true);
    expect(
      Quote.calculate({
        unitPriceInCents: 100,
        units: 1,
        currency: 'COP',
        fees: { ...fees, deliveryFeeInCents: -1 },
      }).isErr(),
    ).toBe(true);
  });

  it('restores a stored quote exactly, without recomputing it from current fees', () => {
    const stored = {
      unitPriceInCents: 100,
      units: 1,
      productInCents: 100,
      baseFeeInCents: 1,
      deliveryFeeInCents: 2,
      totalInCents: 103,
      currency: 'COP',
    };

    expect({ ...Quote.restore(stored) }).toEqual(stored);
  });
});
