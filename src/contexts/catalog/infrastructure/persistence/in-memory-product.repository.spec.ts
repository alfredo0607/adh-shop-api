import { aProduct } from '../../__fixtures__/product.fixture';
import type { StockLine } from '../../domain/product.repository';
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
    const line = (productId: string, units: number): StockLine => ({ productId, units });

    const stockOf = async (
      repository: InMemoryProductRepository,
      id: string,
    ): Promise<{ available: number; reserved: number }> => {
      const product = await repository.findById(id);
      if (product.isErr()) throw new Error('fixture product vanished');
      return { available: product.value.stock.available, reserved: product.value.stock.reserved };
    };

    it('persists a reservation so the next read sees it', async () => {
      const repository = new InMemoryProductRepository([aProduct({ id: 'p1', available: 10 })]);

      await repository.reserveAll([line('p1', 4)]);

      // A mock would pass this without storing anything. A real double does not.
      expect(await stockOf(repository, 'p1')).toEqual({ available: 6, reserved: 4 });
    });

    it('reserves every line of an order together', async () => {
      const repository = new InMemoryProductRepository([
        aProduct({ id: 'p1', available: 10 }),
        aProduct({ id: 'p2', available: 2 }),
      ]);

      const result = await repository.reserveAll([line('p1', 3), line('p2', 2)]);

      expect(result.isOk() && result.value.map((product) => product.id)).toEqual(['p1', 'p2']);
      expect(await stockOf(repository, 'p1')).toEqual({ available: 7, reserved: 3 });
      expect(await stockOf(repository, 'p2')).toEqual({ available: 0, reserved: 2 });
    });

    it('changes nothing when any line is short, and says which one', async () => {
      const repository = new InMemoryProductRepository([
        aProduct({ id: 'p1', available: 10 }),
        aProduct({ id: 'p2', available: 2 }),
      ]);

      const result = await repository.reserveAll([line('p1', 3), line('p2', 5)]);

      expect(result.isErr() && result.error.details).toEqual({
        productId: 'p2',
        requested: 5,
        available: 2,
      });
      expect(await stockOf(repository, 'p1')).toEqual({ available: 10, reserved: 0 });
      expect(await stockOf(repository, 'p2')).toEqual({ available: 2, reserved: 0 });
    });

    it('confirms a reservation, removing the units', async () => {
      const repository = new InMemoryProductRepository([aProduct({ id: 'p1', available: 10 })]);

      await repository.reserveAll([line('p1', 3)]);
      await repository.confirmAll([line('p1', 3)]);

      expect(await stockOf(repository, 'p1')).toEqual({ available: 7, reserved: 0 });
    });

    it('releases a reservation, restoring the shelf exactly', async () => {
      const repository = new InMemoryProductRepository([aProduct({ id: 'p1', available: 10 })]);

      await repository.reserveAll([line('p1', 3)]);
      await repository.releaseAll([line('p1', 3)]);

      expect(await stockOf(repository, 'p1')).toEqual({ available: 10, reserved: 0 });
    });

    it.each(['reserveAll', 'confirmAll', 'releaseAll'] as const)(
      '%s reports not found for an unknown product',
      async (method) => {
        const result = await new InMemoryProductRepository()[method]([line('missing', 1)]);

        expect(result.isErr() && result.error.code).toBe('PRODUCT_NOT_FOUND');
      },
    );

    it.each([
      ['no lines', []],
      ['the same product twice', [line('p1', 1), line('p1', 1)]],
      ['zero units', [line('p1', 0)]],
    ])('refuses %s', async (_case, lines) => {
      const repository = new InMemoryProductRepository([aProduct({ id: 'p1', available: 10 })]);

      const result = await repository.reserveAll(lines);

      expect(result.isErr() && result.error.code).toBe('INVALID_STOCK');
    });
  });
});
