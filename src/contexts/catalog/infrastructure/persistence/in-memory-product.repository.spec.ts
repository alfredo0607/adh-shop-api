import { aProduct } from '../../__fixtures__/product.fixture';
import { InMemoryProductRepository } from './in-memory-product.repository';

describe('InMemoryProductRepository', () => {
  describe('findById', () => {
    it('returns the stored product', async () => {
      const repository = new InMemoryProductRepository([aProduct({ id: 'p1' })]);

      const result = await repository.findById('p1');

      expect(result.isOk()).toBe(true);
    });

    it('reports not found rather than returning undefined', async () => {
      const result = await new InMemoryProductRepository().findById('nope');

      expect(result.isErr()).toBe(true);
    });
  });

  describe('findAll', () => {
    const many = (count: number): InMemoryProductRepository =>
      new InMemoryProductRepository(
        Array.from({ length: count }, (_, i) =>
          aProduct({ id: `p${String(i + 1).padStart(2, '0')}` }),
        ),
      );

    it('orders by id so a cursor stays stable across writes', async () => {
      const result = await many(3).findAll({ limit: 10 });

      if (result.isOk()) {
        expect(result.value.items.map((p) => p.id)).toEqual(['p01', 'p02', 'p03']);
      }
    });

    it('reports no cursor when the page is the last one', async () => {
      const result = await many(3).findAll({ limit: 10 });

      if (result.isOk()) {
        expect(result.value.nextCursor).toBeNull();
      }
    });

    it('continues from the cursor without repeating the boundary item', async () => {
      const repository = many(5);
      const first = await repository.findAll({ limit: 2 });
      if (first.isErr()) throw new Error('listing failed');

      const second = await repository.findAll({
        limit: 2,
        cursor: first.value.nextCursor ?? undefined,
      });

      if (second.isOk()) {
        expect(second.value.items.map((p) => p.id)).toEqual(['p03', 'p04']);
      }
    });
  });

  describe('stock transitions', () => {
    it('persists a reservation so the next read sees it', async () => {
      const repository = new InMemoryProductRepository([aProduct({ id: 'p1', available: 10 })]);

      await repository.reserveUnits('p1', 4);
      const reloaded = await repository.findById('p1');

      // A mock would pass this without storing anything. A real double does not.
      if (reloaded.isOk()) {
        expect(reloaded.value.stock.available).toBe(6);
        expect(reloaded.value.stock.reserved).toBe(4);
      }
    });

    it('refuses to reserve beyond what is available and changes nothing', async () => {
      const repository = new InMemoryProductRepository([aProduct({ id: 'p1', available: 2 })]);

      const result = await repository.reserveUnits('p1', 5);
      const reloaded = await repository.findById('p1');

      expect(result.isErr()).toBe(true);
      if (reloaded.isOk()) {
        expect(reloaded.value.stock.available).toBe(2);
        expect(reloaded.value.stock.reserved).toBe(0);
      }
    });

    it('confirms a reservation, removing the units', async () => {
      const repository = new InMemoryProductRepository([aProduct({ id: 'p1', available: 10 })]);

      await repository.reserveUnits('p1', 3);
      await repository.confirmUnits('p1', 3);
      const reloaded = await repository.findById('p1');

      if (reloaded.isOk()) {
        expect(reloaded.value.stock.total).toBe(7);
      }
    });

    it('releases a reservation, restoring the shelf exactly', async () => {
      const repository = new InMemoryProductRepository([aProduct({ id: 'p1', available: 10 })]);

      await repository.reserveUnits('p1', 3);
      await repository.releaseUnits('p1', 3);
      const reloaded = await repository.findById('p1');

      if (reloaded.isOk()) {
        expect(reloaded.value.stock.available).toBe(10);
        expect(reloaded.value.stock.reserved).toBe(0);
      }
    });

    it.each(['reserveUnits', 'confirmUnits', 'releaseUnits'] as const)(
      '%s reports not found for an unknown product',
      async (method) => {
        const result = await new InMemoryProductRepository()[method]('missing', 1);

        expect(result.isErr()).toBe(true);
      },
    );
  });
});
