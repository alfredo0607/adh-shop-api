import type { ResultAsync } from '../../../shared/domain';

import type {
  CatalogUnavailable,
  InsufficientStock,
  InvalidCursor,
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

/** Some units of one product. An order is a list of these, one per product. */
export interface StockLine {
  readonly productId: string;
  readonly units: number;
}

export interface ProductRepository {
  findAll(query: {
    limit: number;
    cursor?: string | undefined;
  }): ResultAsync<ProductPage, InvalidCursor | CatalogUnavailable>;

  findById(id: string): ResultAsync<Product, ProductNotFound | CatalogUnavailable>;

  /**
   * Moves units from available to reserved, for every line at once: either
   * all the products of an order are held, or none is.
   *
   * Deliberately not `save(product)`. A read-modify-write would let two buyers
   * both read the last unit, both pass the check in memory and both write back
   * a successful reservation. The condition has to be evaluated by the store,
   * atomically, which means the store needs to be told the intent rather than
   * handed a finished object.
   *
   * Returns the products as they stood when the units were taken, so the
   * price charged is the price of the units actually held.
   */
  reserveAll(lines: readonly StockLine[]): ResultAsync<Product[], StockTransitionError>;

  /** Returns held units to the shelf, for every line at once. */
  releaseAll(lines: readonly StockLine[]): ResultAsync<void, StockTransitionError>;

  /** Turns held units into sold ones, for every line at once. */
  confirmAll(lines: readonly StockLine[]): ResultAsync<void, StockTransitionError>;
}

export const PRODUCT_REPOSITORY = Symbol('ProductRepository');
