import { Quote } from './quote';

describe('Quote', () => {
  const fees = { baseFeeInCents: 500_00, deliveryFeeInCents: 1_200_00 };

  const item = (
    productId: string,
    unitPriceInCents: number,
    units: number,
    currency = 'COP',
  ): Parameters<typeof Quote.calculate>[0]['items'][number] => ({
    productId,
    name: `Product ${productId}`,
    unitPriceInCents,
    units,
    currency,
  });

  it('adds the product amount and both fees, in whole cents', () => {
    const result = Quote.calculate({ items: [item('a', 89_990_00, 2)], fees });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.productInCents).toBe(179_980_00);
    expect(result.value.totalInCents).toBe(179_980_00 + 500_00 + 1_200_00);
    expect(Number.isInteger(result.value.totalInCents)).toBe(true);
  });

  it('prices each line, adds them up, and charges the fees once per order', () => {
    const result = Quote.calculate({
      items: [item('a', 89_990_00, 1), item('b', 42_500_00, 2)],
      fees,
    });

    if (result.isErr()) throw new Error('expected a quote');
    expect(result.value.lines.map((line) => line.lineTotalInCents)).toEqual([89_990_00, 85_000_00]);
    expect(result.value.productInCents).toBe(174_990_00);
    expect(result.value.totalInCents).toBe(174_990_00 + 500_00 + 1_200_00);
    expect(result.value.units).toBe(3);
    expect(result.value.currency).toBe('COP');
  });

  it.each([0, -1, 1.5, 11])('rejects %p units', (units) => {
    const result = Quote.calculate({ items: [item('a', 100, units)], fees });

    expect(result.isErr() && result.error.code).toBe('INVALID_TRANSACTION');
  });

  it('rejects an empty order', () => {
    expect(Quote.checkItems([]).isErr()).toBe(true);
  });

  it(`rejects more than ${Quote.MAX_ITEMS} products in one order`, () => {
    const items = Array.from({ length: Quote.MAX_ITEMS + 1 }, (_, index) => ({
      productId: `p-${index}`,
      units: 1,
    }));

    expect(Quote.checkItems(items).isErr()).toBe(true);
    expect(Quote.checkItems(items.slice(0, Quote.MAX_ITEMS)).isOk()).toBe(true);
  });

  it('rejects the same product twice, which would be one line with more units', () => {
    const result = Quote.checkItems([
      { productId: 'a', units: 1 },
      { productId: 'a', units: 2 },
    ]);

    expect(result.isErr() && result.error.code).toBe('INVALID_TRANSACTION');
  });

  it('names the product whose units are out of range', () => {
    const result = Quote.checkItems([
      { productId: 'a', units: 1 },
      { productId: 'b', units: 12 },
    ]);

    expect(result.isErr() && result.error.details).toEqual({ productId: 'b', units: 12 });
  });

  it('rejects products priced in different currencies', () => {
    const result = Quote.calculate({ items: [item('a', 100, 1), item('b', 100, 1, 'USD')], fees });

    expect(result.isErr() && result.error.code).toBe('INVALID_TRANSACTION');
  });

  it('rejects a fractional or negative amount, which would mean a pricing defect', () => {
    expect(Quote.calculate({ items: [item('a', 10.5, 1)], fees }).isErr()).toBe(true);
    expect(
      Quote.calculate({
        items: [item('a', 100, 1)],
        fees: { ...fees, deliveryFeeInCents: -1 },
      }).isErr(),
    ).toBe(true);
  });

  it('restores a stored quote exactly, without recomputing it from current fees', () => {
    const stored = {
      lines: [
        { productId: 'a', name: 'A', unitPriceInCents: 100, units: 1, lineTotalInCents: 100 },
      ],
      productInCents: 100,
      baseFeeInCents: 1,
      deliveryFeeInCents: 2,
      totalInCents: 103,
      currency: 'COP',
    };

    expect({ ...Quote.restore(stored) }).toEqual(stored);
  });
});
