import { Money } from './money';
import { Product } from './product';
import { Stock } from './stock';

const buildProduct = (available: number, reserved = 0, version = 0): Product => {
  const price = Money.create(150_000, 'COP');
  const stock = Stock.create(available, reserved);
  if (price.isErr() || stock.isErr()) throw new Error('fixture is invalid');

  const product = Product.create({
    id: 'prod-1',
    name: 'Cafetera',
    description: 'A coffee maker',
    category: 'coffee-makers',
    price: price.value,
    imageKey: 'product/cafetera.webp',
    stock: stock.value,
    version,
  });
  if (product.isErr()) throw new Error('fixture is invalid');

  return product.value;
};

describe('Product', () => {
  describe('create', () => {
    it('rejects an empty id', () => {
      const price = Money.create(1, 'COP');
      const stock = Stock.create(1);
      if (price.isErr() || stock.isErr()) throw new Error('fixture is invalid');

      const result = Product.create({
        id: '   ',
        name: 'x',
        description: '',
        category: 'coffee-makers',
        price: price.value,
        imageKey: '',
        stock: stock.value,
      });

      expect(result.isErr()).toBe(true);
    });

    it('rejects a blank name', () => {
      const price = Money.create(1, 'COP');
      const stock = Stock.create(1);
      if (price.isErr() || stock.isErr()) throw new Error('fixture is invalid');

      const result = Product.create({
        id: 'p',
        name: '  ',
        description: '',
        category: 'coffee-makers',
        price: price.value,
        imageKey: '',
        stock: stock.value,
      });

      expect(result.isErr()).toBe(true);
    });

    it('rejects a category the store does not have', () => {
      const price = Money.create(1, 'COP');
      const stock = Stock.create(1);
      if (price.isErr() || stock.isErr()) throw new Error('fixture is invalid');

      const result = Product.create({
        id: 'p',
        name: 'Cafetera',
        description: '',
        category: 'furniture',
        price: price.value,
        imageKey: '',
        stock: stock.value,
      });

      expect(result.isErr() && result.error.code).toBe('INVALID_PRODUCT');
    });

    it('starts at version zero when none is supplied', () => {
      expect(buildProduct(5).version).toBe(0);
    });
  });

  describe('purchasability', () => {
    it('is purchasable while units remain', () => {
      expect(buildProduct(1).isPurchasable).toBe(true);
    });

    it('is not purchasable once every unit is reserved', () => {
      // Held units belong to a checkout in progress, not to the shelf.
      expect(buildProduct(0, 5).isPurchasable).toBe(false);
    });
  });

  describe('stock transitions', () => {
    it('delegates the rule to Stock rather than reimplementing it', () => {
      const result = buildProduct(10).reserve(3);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.stock.available).toBe(7);
        expect(result.value.stock.reserved).toBe(3);
      }
    });

    it('propagates the domain error when the rule rejects', () => {
      const result = buildProduct(2).reserve(5);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('INSUFFICIENT_STOCK');
      }
    });

    it('confirms and releases a reservation', () => {
      const reserved = buildProduct(10).reserve(4);
      if (reserved.isErr()) throw new Error('reserve failed');

      const confirmed = reserved.value.confirmReservation(4);
      const released = reserved.value.releaseReservation(4);

      expect(confirmed.isOk()).toBe(true);
      expect(released.isOk()).toBe(true);
      if (confirmed.isOk()) expect(confirmed.value.stock.total).toBe(6);
      if (released.isOk()) expect(released.value.stock.available).toBe(10);
    });
  });

  describe('versioning', () => {
    it('increments on every change, so the store can detect a lost update', () => {
      const reserved = buildProduct(10, 0, 7).reserve(1);

      if (reserved.isOk()) {
        expect(reserved.value.version).toBe(8);
      }
    });

    it('leaves the original untouched', () => {
      const original = buildProduct(10, 0, 7);

      original.reserve(1);

      // Two concurrent requests holding the same reference must not see each
      // other's changes; the optimistic lock is what resolves the conflict.
      expect(original.version).toBe(7);
      expect(original.stock.available).toBe(10);
    });
  });

  describe('toSnapshot', () => {
    it('flattens the value objects for persistence and transport', () => {
      expect(buildProduct(8, 2, 3).toSnapshot()).toEqual({
        id: 'prod-1',
        name: 'Cafetera',
        description: 'A coffee maker',
        category: 'coffee-makers',
        priceInCents: 150_000,
        currency: 'COP',
        imageKey: 'product/cafetera.webp',
        available: 8,
        reserved: 2,
        version: 3,
      });
    });
  });
});
