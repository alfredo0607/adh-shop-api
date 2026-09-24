import { ResultAsync, err, ok } from '../../../../shared/domain';
import { type CatalogUnavailable, ProductNotFound } from '../../domain/catalog.errors';
import type { Product } from '../../domain/product';
import type {
  ProductPage,
  ProductRepository,
  StockTransitionError,
} from '../../domain/product.repository';

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
  }): ResultAsync<ProductPage, CatalogUnavailable> {
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

  reserveUnits(productId: string, units: number): ResultAsync<Product, StockTransitionError> {
    return this.apply(productId, (product) => product.reserve(units));
  }

  releaseUnits(productId: string, units: number): ResultAsync<Product, StockTransitionError> {
    return this.apply(productId, (product) => product.releaseReservation(units));
  }

  confirmUnits(productId: string, units: number): ResultAsync<Product, StockTransitionError> {
    return this.apply(productId, (product) => product.confirmReservation(units));
  }

  private apply(
    productId: string,
    transition: (product: Product) => ReturnType<Product['reserve']>,
  ): ResultAsync<Product, StockTransitionError> {
    const product = this.products.get(productId);

    if (product === undefined) {
      return ResultAsync.fromResult(err(new ProductNotFound(productId)));
    }

    const result = transition(product);

    if (result.isErr()) {
      return ResultAsync.fromResult(err(result.error));
    }

    this.products.set(productId, result.value);
    return ResultAsync.fromResult(ok(result.value));
  }
}
