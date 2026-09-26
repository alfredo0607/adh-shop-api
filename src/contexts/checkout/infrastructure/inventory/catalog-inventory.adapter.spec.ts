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
      aProduct({ id: 'p2', available: 1, priceInCents: 40_000 }),
    ]);
    return { products, inventory: new CatalogInventoryAdapter(products) };
  };

  const stockOf = async (products: InMemoryProductRepository, id: string): Promise<number> => {
    const product = await products.findById(id);
    if (product.isErr()) throw new Error('fixture product vanished');
    return product.value.stock.available;
  };

  it('describes the products in the checkout’s terms, in the order asked for', async () => {
    const result = await setup().inventory.offers(['p2', 'p1']);

    expect(result.isOk() && result.value).toEqual([
      {
        productId: 'p2',
        name: expect.any(String),
        unitPriceInCents: 40_000,
        currency: 'COP',
        availableUnits: 1,
      },
      {
        productId: 'p1',
        name: expect.any(String),
        unitPriceInCents: 150_000,
        currency: 'COP',
        availableUnits: 3,
      },
    ]);
  });

  it('reserves and releases every item together', async () => {
    const { inventory, products } = setup();
    const items = [
      { productId: 'p1', units: 2 },
      { productId: 'p2', units: 1 },
    ];

    const reserved = await inventory.reserve(items);
    expect(reserved.isOk() && reserved.value.map((offer) => offer.productId)).toEqual(['p1', 'p2']);
    expect(await stockOf(products, 'p1')).toBe(1);
    expect(await stockOf(products, 'p2')).toBe(0);

    await inventory.release(items);
    expect(await stockOf(products, 'p1')).toBe(3);
    expect(await stockOf(products, 'p2')).toBe(1);
  });

  it('translates the catalogue’s errors into the checkout’s, naming the product', async () => {
    const { inventory } = setup();

    const missing = await inventory.offers(['p1', 'nope']);
    const unknown = await inventory.reserve([{ productId: 'nope', units: 1 }]);
    const short = await inventory.reserve([
      { productId: 'p1', units: 1 },
      { productId: 'p2', units: 5 },
    ]);

    expect(missing.isErr() && missing.error.details).toEqual({ productId: 'nope' });
    expect(unknown.isErr() && unknown.error.code).toBe('PRODUCT_NOT_FOUND');
    expect(short.isErr() && short.error.details).toEqual({
      productId: 'p2',
      requested: 5,
      available: 1,
    });
  });

  it('reports a failing catalogue as the checkout being unavailable', async () => {
    const { inventory, products } = setup();
    const down = new CatalogUnavailable('down');
    jest.spyOn(products, 'reserveAll').mockReturnValue(ResultAsync.err(down));
    jest.spyOn(products, 'releaseAll').mockReturnValue(ResultAsync.err(down));
    jest.spyOn(products, 'findById').mockReturnValue(ResultAsync.err(down));

    const items = [{ productId: 'p1', units: 1 }];
    const offers = await inventory.offers(['p1']);
    const reserve = await inventory.reserve(items);
    const release = await inventory.release(items);

    expect(offers.isErr() && offers.error.code).toBe('CHECKOUT_UNAVAILABLE');
    expect(reserve.isErr() && reserve.error.code).toBe('CHECKOUT_UNAVAILABLE');
    expect(release.isErr() && release.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });
});
