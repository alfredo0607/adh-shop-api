import type { ResultAsync } from '../../../shared/domain';

import type { CheckoutUnavailable, OutOfStock, UnknownProduct } from './checkout.errors';
import type { OrderItem } from './quote';

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
  /** The products of an order as they stand now, in the order asked for. */
  offers(
    productIds: readonly string[],
  ): ResultAsync<ProductOffer[], UnknownProduct | CheckoutUnavailable>;

  /**
   * Holds the units of every item, atomically: all of them or none. The offers
   * returned, in the order of the items, are the products as they stood at the
   * moment of the reservation, so the price charged is the price of the units
   * actually held.
   */
  reserve(
    items: readonly OrderItem[],
  ): ResultAsync<ProductOffer[], UnknownProduct | OutOfStock | CheckoutUnavailable>;

  release(items: readonly OrderItem[]): ResultAsync<void, CheckoutUnavailable>;
}

export const INVENTORY_PORT = Symbol('InventoryPort');
