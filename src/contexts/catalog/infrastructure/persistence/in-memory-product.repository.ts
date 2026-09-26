import { ResultAsync, err } from '../../../../shared/domain';
import {
  type CatalogUnavailable,
  InsufficientStock,
  type InvalidCursor,
  ProductNotFound,
} from '../../domain/catalog.errors';
import type { Product } from '../../domain/product';
import type {
  ProductPage,
  ProductRepository,
  StockLine,
  StockTransitionError,
} from '../../domain/product.repository';
import { checkStockLines } from '../../domain/stock';

/**
 * In-memory implementation of the port, for tests.
 *
 * A real implementation rather than a mock. A mock asserts that a method was
 * called; this actually behaves like a repository, so a use case that saves
 * twice, reads stale data or forgets to persist a change fails the test. It
 * also runs in milliseconds and needs no container, which is what makes it
 * practical to test every use case against it.
 *
 * The conditional operations mirror what DynamoDB enforces server-side, so a
 * use case cannot pass here and fail there for reasons of ordering.
 */
export class InMemoryProductRepository implements ProductRepository {
  private readonly products = new Map<string, Product>();

  constructor(seed: readonly Product[] = []) {
    for (const product of seed) {
      this.products.set(product.id, product);
    }
  }

  findAll(query: {
    limit: number;
    cursor?: string | undefined;
  }): ResultAsync<ProductPage, InvalidCursor | CatalogUnavailable> {
    // Sorted by id so pagination is stable. Insertion order would make the same
    // cursor return different items after a write.
    const all = [...this.products.values()].sort((a, b) => a.id.localeCompare(b.id));

    const start = query.cursor === undefined ? 0 : all.findIndex((p) => p.id > query.cursor!);
    const from = start === -1 ? all.length : start;
    const items = all.slice(from, from + query.limit);
    const hasMore = from + query.limit < all.length;

    return ResultAsync.ok({
      items,
      nextCursor: hasMore && items.length > 0 ? (items[items.length - 1]?.id ?? null) : null,
    });
  }

  findById(id: string): ResultAsync<Product, ProductNotFound | CatalogUnavailable> {
    const product = this.products.get(id);

    return product === undefined
      ? ResultAsync.fromResult(err(new ProductNotFound(id)))
      : ResultAsync.ok(product);
  }

  reserveAll(lines: readonly StockLine[]): ResultAsync<Product[], StockTransitionError> {
    return this.applyAll(lines, (product, units) => product.reserve(units));
  }

  releaseAll(lines: readonly StockLine[]): ResultAsync<void, StockTransitionError> {
    return this.applyAll(lines, (product, units) => product.releaseReservation(units)).map(
      () => undefined,
    );
  }

  confirmAll(lines: readonly StockLine[]): ResultAsync<void, StockTransitionError> {
    return this.applyAll(lines, (product, units) => product.confirmReservation(units)).map(
      () => undefined,
    );
  }

  /**
   * All or nothing, as the DynamoDB transaction is: every transition is
   * computed first, and the store changes only if all of them succeed.
   */
  private applyAll(
    lines: readonly StockLine[],
    transition: (product: Product, units: number) => ReturnType<Product['reserve']>,
  ): ResultAsync<Product[], StockTransitionError> {
    const checked = checkStockLines(lines);
    if (checked.isErr()) {
      return ResultAsync.err(checked.error);
    }

    const next: Product[] = [];
    for (const { productId, units } of checked.value) {
      const product = this.products.get(productId);
      if (product === undefined) {
        return ResultAsync.err(new ProductNotFound(productId));
      }

      const result = transition(product, units);
      if (result.isErr()) {
        const error = result.error;
        return ResultAsync.err(
          error instanceof InsufficientStock ? error.forProduct(productId) : error,
        );
      }
      next.push(result.value);
    }

    for (const product of next) {
      this.products.set(product.id, product);
    }
    return ResultAsync.ok(next);
  }
}
