import { ResultAsync } from '../../../../shared/domain';
import { aProduct } from '../../../catalog/__fixtures__/product.fixture';
import { CatalogUnavailable } from '../../../catalog/domain/catalog.errors';
import { InMemoryProductRepository } from '../../../catalog/infrastructure/persistence/in-memory-product.repository';
import { CatalogInventoryAdapter } from './catalog-inventory.adapter';

describe('CatalogInventoryAdapter', () => {
  const setup = (): {
    products: InMemoryProductRepository;
    inventory: CatalogInventoryAdapter;
  } => {
    const products = new InMemoryProductRepository([
      aProduct({ id: 'p1', available: 3, priceInCents: 150_000 }),
    ]);
    return { products, inventory: new CatalogInventoryAdapter(products) };
  };

  it('describes a product in the checkout’s terms', async () => {
    const result = await setup().inventory.offer('p1');

    expect(result.isOk() && result.value).toEqual({
      productId: 'p1',
      name: expect.any(String),
      unitPriceInCents: 150_000,
      currency: 'COP',
      availableUnits: 3,
    });
  });

  it('reserves and releases units', async () => {
    const { inventory, products } = setup();

    await inventory.reserve('p1', 2);
    await inventory.release('p1', 2);

    const product = await products.findById('p1');
    expect(product.isOk() && product.value.stock.available).toBe(3);
  });

  it('translates the catalogue’s errors into the checkout’s', async () => {
    const { inventory } = setup();

    const missing = await inventory.offer('nope');
    const short = await inventory.reserve('p1', 5);

    expect(missing.isErr() && missing.error.code).toBe('PRODUCT_NOT_FOUND');
    expect(short.isErr() && short.error.details).toEqual({
      productId: 'p1',
      requested: 5,
      available: 3,
    });
  });

  it('reports a failing catalogue as the checkout being unavailable', async () => {
    const { inventory, products } = setup();
    const down = new CatalogUnavailable('down');
    jest.spyOn(products, 'reserveUnits').mockReturnValue(ResultAsync.err(down));
    jest.spyOn(products, 'releaseUnits').mockReturnValue(ResultAsync.err(down));

    const reserve = await inventory.reserve('p1', 1);
    const release = await inventory.release('p1', 1);

    expect(reserve.isErr() && reserve.error.code).toBe('CHECKOUT_UNAVAILABLE');
    expect(release.isErr() && release.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });
});
