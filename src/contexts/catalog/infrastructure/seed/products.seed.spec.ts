import { Money } from '../../domain/money';
import { Product } from '../../domain/product';
import { Stock } from '../../domain/stock';
import { PRODUCT_SEED } from './products.seed';

/**
 * The seed is the only way inventory enters the system, so a malformed entry
 * is not a cosmetic problem: it produces a store that cannot be listed. These
 * assertions run the seed through the same domain constructors the repository
 * uses, which is the only way to know it is actually loadable.
 */
describe('PRODUCT_SEED', () => {
  it('is not empty, since the brief requires a seeded catalogue', () => {
    expect(PRODUCT_SEED.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = PRODUCT_SEED.map((product) => product.id);

    // A duplicate would silently overwrite the earlier product on write.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(PRODUCT_SEED.map((product) => [product.id, product] as const))(
    '%s builds a valid domain product',
    (_id, seed) => {
      const price = Money.create(seed.priceInCents, seed.currency);
      const stock = Stock.create(seed.available, 0);

      expect(price.isOk()).toBe(true);
      expect(stock.isOk()).toBe(true);
      if (price.isErr() || stock.isErr()) return;

      const product = Product.create({
        id: seed.id,
        name: seed.name,
        description: seed.description,
        price: price.value,
        imageKey: seed.imageKey,
        stock: stock.value,
      });

      expect(product.isOk()).toBe(true);
    },
  );

  it('prices every product in integer minor units', () => {
    for (const product of PRODUCT_SEED) {
      expect(Number.isInteger(product.priceInCents)).toBe(true);
      expect(product.priceInCents).toBeGreaterThan(0);
    }
  });

  it('includes a sold out product, so the empty state is reachable without buying one out', () => {
    expect(PRODUCT_SEED.some((product) => product.available === 0)).toBe(true);
  });

  it('includes purchasable products', () => {
    expect(PRODUCT_SEED.filter((product) => product.available > 0).length).toBeGreaterThan(1);
  });
});
