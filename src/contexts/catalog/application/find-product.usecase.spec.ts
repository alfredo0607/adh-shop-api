import { InMemoryProductRepository } from '../infrastructure/persistence/in-memory-product.repository';
import { aProduct } from '../__fixtures__/product.fixture';
import { FindProduct } from './find-product.usecase';

describe('FindProduct', () => {
  it('returns the product when it exists', async () => {
    const repository = new InMemoryProductRepository([aProduct({ id: 'prod-1' })]);

    const result = await new FindProduct(repository).execute('prod-1');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.id).toBe('prod-1');
    }
  });

  it('reports a domain error rather than returning null', async () => {
    const result = await new FindProduct(new InMemoryProductRepository()).execute('missing');

    // Returning null would push the decision onto every caller, and one of
    // them would eventually forget to check.
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('PRODUCT_NOT_FOUND');
      expect(result.error.kind).toBe('NOT_FOUND');
    }
  });
});
