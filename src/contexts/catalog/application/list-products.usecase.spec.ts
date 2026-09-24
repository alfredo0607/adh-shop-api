import { InMemoryProductRepository } from '../infrastructure/persistence/in-memory-product.repository';
import { aProduct } from '../__fixtures__/product.fixture';
import { ListProducts } from './list-products.usecase';

describe('ListProducts', () => {
  const catalogue = (count: number): InMemoryProductRepository =>
    new InMemoryProductRepository(
      Array.from({ length: count }, (_, i) =>
        aProduct({ id: `prod-${String(i + 1).padStart(2, '0')}` }),
      ),
    );

  it('returns a page of products', async () => {
    const result = await new ListProducts(catalogue(3)).execute();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.items).toHaveLength(3);
      expect(result.value.nextCursor).toBeNull();
    }
  });

  it('applies a default page size rather than returning everything', async () => {
    const result = await new ListProducts(catalogue(30)).execute();

    if (result.isOk()) {
      expect(result.value.items).toHaveLength(20);
      expect(result.value.nextCursor).not.toBeNull();
    }
  });

  it('caps an oversized request instead of rejecting it', async () => {
    // A client asking for 10,000 gets the cap. Erroring would be a worse
    // experience for something the server can simply decide.
    const result = await new ListProducts(catalogue(100)).execute({ limit: 10_000 });

    if (result.isOk()) {
      expect(result.value.items).toHaveLength(50);
    }
  });

  it('honours a smaller page size', async () => {
    const result = await new ListProducts(catalogue(10)).execute({ limit: 3 });

    if (result.isOk()) {
      expect(result.value.items).toHaveLength(3);
    }
  });

  it('walks the whole catalogue through the cursor without repeating an item', async () => {
    const useCase = new ListProducts(catalogue(7));
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 5; page += 1) {
      const result = await useCase.execute({ limit: 3, cursor });
      if (result.isErr()) throw new Error('listing failed');

      seen.push(...result.value.items.map((p) => p.id));
      if (result.value.nextCursor === null) break;
      cursor = result.value.nextCursor;
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('returns an empty page for an empty catalogue', async () => {
    const result = await new ListProducts(new InMemoryProductRepository()).execute();

    if (result.isOk()) {
      expect(result.value.items).toEqual([]);
      expect(result.value.nextCursor).toBeNull();
    }
  });
});
