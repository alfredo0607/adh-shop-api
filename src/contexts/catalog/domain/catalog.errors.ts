import { DomainError } from '../../../shared/domain';

export class ProductNotFound extends DomainError {
  readonly code = 'PRODUCT_NOT_FOUND';
  readonly kind = 'NOT_FOUND' as const;

  constructor(productId: string) {
    super('Product not found', { productId });
  }
}

/**
 * Requested more units than are available.
 *
 * Classified as CONFLICT rather than VALIDATION on purpose: the request was
 * perfectly well formed, it simply lost a race against other buyers. A client
 * that sees 422 concludes it sent something wrong and gives up; one that sees
 * 409 knows the world changed and that retrying with fewer units may work.
 */
export class InsufficientStock extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK';
  readonly kind = 'CONFLICT' as const;

  constructor(requested: number, available: number) {
    super(`Only ${available} units available`, { requested, available });
  }
}

export class InvalidStock extends DomainError {
  readonly code = 'INVALID_STOCK';
  readonly kind = 'VALIDATION' as const;
}

export class InvalidMoney extends DomainError {
  readonly code = 'INVALID_MONEY';
  readonly kind = 'VALIDATION' as const;
}

export class InvalidProduct extends DomainError {
  readonly code = 'INVALID_PRODUCT';
  readonly kind = 'VALIDATION' as const;
}

/**
 * The pagination cursor was not one this service issued.
 *
 * A client mistake, so VALIDATION: reporting it as the catalogue being down
 * would page whoever watches 5xx rates, and tell well-behaved clients to retry
 * a request that can never succeed.
 */
export class InvalidCursor extends DomainError {
  readonly code = 'INVALID_CURSOR';
  readonly kind = 'VALIDATION' as const;

  constructor() {
    super('The pagination cursor is not valid; start again without one');
  }
}

/** Raised by an adapter when the store itself fails, not the business rule. */
export class CatalogUnavailable extends DomainError {
  readonly code = 'CATALOG_UNAVAILABLE';
  readonly kind = 'UNAVAILABLE' as const;

  constructor(message: string, cause?: unknown) {
    // The cause reaches the base class, which is what the exception filter
    // reads. Holding it in a field of its own left it visible to nobody: the
    // log said the catalogue could not be read and never said why, which is
    // how a missing container credential looked like a permissions problem
    // for far longer than it should have.
    super(message, undefined, cause);
  }
}

export type CatalogError =
  | ProductNotFound
  | InsufficientStock
  | InvalidStock
  | InvalidMoney
  | InvalidProduct
  | InvalidCursor
  | CatalogUnavailable;
