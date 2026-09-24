import { Money } from '../domain/money';
import { Product } from '../domain/product';
import { Stock } from '../domain/stock';

/**
 * Builds a valid product, failing loudly if the fixture itself is wrong.
 *
 * A fixture that silently produces something invalid makes every test using it
 * meaningless, so the unwrapping throws rather than returning a Result.
 */
export const aProduct = (
  overrides: { id?: string; available?: number; reserved?: number; priceInCents?: number } = {},
): Product => {
  const price = Money.create(overrides.priceInCents ?? 150_000, 'COP');
  const stock = Stock.create(overrides.available ?? 10, overrides.reserved ?? 0);

  if (price.isErr() || stock.isErr()) {
    throw new Error('product fixture is invalid');
  }

  const product = Product.create({
    id: overrides.id ?? 'prod-1',
    name: 'Cafetera',
    description: 'A coffee maker',
    price: price.value,
    imageUrl: 'https://cdn.test/cafetera.webp',
    stock: stock.value,
  });

  if (product.isErr()) {
    throw new Error('product fixture is invalid');
  }

  return product.value;
};
