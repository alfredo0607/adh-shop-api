import type { ResultAsync } from '../../../shared/domain';

import type { CheckoutUnavailable, OutOfStock, UnknownProduct } from './checkout.errors';

/** What the checkout needs to know about a product to sell it. */
export interface ProductOffer {
  readonly productId: string;
  readonly name: string;
  readonly unitPriceInCents: number;
  readonly currency: string;
  readonly availableUnits: number;
}

/**
 * The checkout's view of stock.
 *
 * Declared here, in the checkout's terms, rather than importing the catalogue's
 * repository. The checkout needs three operations on stock and nothing else the
 * catalogue can do; depending on the whole repository would couple the two
 * contexts to each other's internals.
 */
export interface InventoryPort {
  offer(productId: string): ResultAsync<ProductOffer, UnknownProduct | CheckoutUnavailable>;

  /**
   * Holds units for a buyer, atomically. The offer returned is the product as
   * it stood at the moment of the reservation, so the price charged is the
   * price of the units actually held.
   */
  reserve(
    productId: string,
    units: number,
  ): ResultAsync<ProductOffer, UnknownProduct | OutOfStock | CheckoutUnavailable>;

  release(productId: string, units: number): ResultAsync<void, CheckoutUnavailable>;
}

export const INVENTORY_PORT = Symbol('InventoryPort');
