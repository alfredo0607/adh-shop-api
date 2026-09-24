import type { ResultAsync } from '../../../shared/domain';
import type { CatalogUnavailable } from '../domain/catalog.errors';
import type { ProductPage, ProductRepository } from '../domain/product.repository';

export interface ListProductsQuery {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

/**
 * Lists the catalogue, one page at a time.
 *
 * Paginated from the first day even though the seed holds a handful of
 * products. An unbounded list endpoint works perfectly until the table grows,
 * and by then every client depends on receiving everything at once — so the fix
 * becomes a breaking change rather than a configuration value.
 */
export class ListProducts {
  /** Caps what a client can ask for. A request for 10,000 gets the cap. */
  private static readonly MAX_LIMIT = 50;
  private static readonly DEFAULT_LIMIT = 20;

  constructor(private readonly products: ProductRepository) {}

  execute(query: ListProductsQuery = {}): ResultAsync<ProductPage, CatalogUnavailable> {
    const limit = Math.min(query.limit ?? ListProducts.DEFAULT_LIMIT, ListProducts.MAX_LIMIT);

    return this.products.findAll({ limit, cursor: query.cursor });
  }
}
