import { DomainError } from '../../../shared/domain';

export class TransactionNotFound extends DomainError {
  readonly code = 'TRANSACTION_NOT_FOUND';
  readonly kind = 'NOT_FOUND' as const;

  constructor(transactionId: string) {
    super('Transaction not found', { transactionId });
  }
}

/**
 * The product being bought does not exist.
 *
 * The checkout's own error rather than the catalogue's. The checkout asks its
 * inventory port for units and should not care that the answer came from a
 * catalogue module, a warehouse service or anything else.
 */
export class UnknownProduct extends DomainError {
  readonly code = 'PRODUCT_NOT_FOUND';
  readonly kind = 'NOT_FOUND' as const;

  constructor(productId: string) {
    super('Product not found', { productId });
  }
}

/** CONFLICT, not VALIDATION: the request was fine, the shelf changed. */
export class OutOfStock extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK';
  readonly kind = 'CONFLICT' as const;

  constructor(productId: string, requested: number, available: number) {
    super(`Only ${available} units available`, { productId, requested, available });
  }
}

export class InvalidCustomer extends DomainError {
  readonly code = 'INVALID_CUSTOMER';
  readonly kind = 'VALIDATION' as const;
}

export class InvalidDeliveryAddress extends DomainError {
  readonly code = 'INVALID_DELIVERY_ADDRESS';
  readonly kind = 'VALIDATION' as const;
}

export class InvalidTransaction extends DomainError {
  readonly code = 'INVALID_TRANSACTION';
  readonly kind = 'VALIDATION' as const;
}

/**
 * The total the buyer was shown is not the total the server computes.
 *
 * Prices and fees can change between the summary screen and the pay button.
 * Charging the new amount anyway would take money the buyer never agreed to;
 * refusing lets the client show the new total and ask again.
 */
export class AmountMismatch extends DomainError {
  readonly code = 'AMOUNT_MISMATCH';
  readonly kind = 'VALIDATION' as const;

  constructor(expectedInCents: number, actualInCents: number) {
    super('The total has changed since it was shown', { expectedInCents, actualInCents });
  }
}

/** Raised by an adapter when a store fails, not a business rule. */
export class CheckoutUnavailable extends DomainError {
  readonly code = 'CHECKOUT_UNAVAILABLE';
  readonly kind = 'UNAVAILABLE' as const;

  constructor(message: string, cause?: unknown) {
    super(message, undefined, cause);
  }
}
