import type { ResultAsync } from '../../../shared/domain';

import type {
  CatalogUnavailable,
  InsufficientStock,
  InvalidStock,
  ProductNotFound,
} from './catalog.errors';
import type { Product } from './product';

export interface ProductPage {
  readonly items: readonly Product[];
  /** Opaque continuation token. Null when there is nothing more to read. */
  readonly nextCursor: string | null;
}

/**
 * Port. Named for what the domain needs, not for what implements it — the
 * domain must not be able to tell whether the other side is DynamoDB, Postgres
 * or a map in memory.
 */
/**
 * Errors a stock transition can produce.
 *
 * InvalidStock belongs here because the entity can reject the request itself —
 * asking to reserve zero units never reaches the store. Leaving it out made the
 * port promise a narrower contract than any implementation could honour, which
 * the compiler caught the first time an adapter was written against it.
 */
export type StockTransitionError =
  ProductNotFound | InsufficientStock | InvalidStock | CatalogUnavailable;

export interface ProductRepository {
  findAll(query: {
    limit: number;
    cursor?: string | undefined;
  }): ResultAsync<ProductPage, CatalogUnavailable>;

  findById(id: string): ResultAsync<Product, ProductNotFound | CatalogUnavailable>;

  /**
   * Moves units from available to reserved in a single conditional write.
   *
   * Deliberately not `save(product)`. A read-modify-write would let two buyers
   * both read the last unit, both pass the check in memory and both write back
   * a successful reservation. The condition has to be evaluated by the store,
   * atomically, which means the store needs to be told the intent rather than
   * handed a finished object.
   */
  reserveUnits(productId: string, units: number): ResultAsync<Product, StockTransitionError>;

  releaseUnits(productId: string, units: number): ResultAsync<Product, StockTransitionError>;

  confirmUnits(productId: string, units: number): ResultAsync<Product, StockTransitionError>;
}

export const PRODUCT_REPOSITORY = Symbol('ProductRepository');
