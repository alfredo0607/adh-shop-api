import { ResultAsync, err, type Result } from '../../../shared/domain';
import {
  type CheckoutUnavailable,
  type InvalidTransaction,
  OutOfStock,
  type UnknownProduct,
} from '../domain/checkout.errors';
import type { InventoryPort } from '../domain/inventory.port';
import { type Fees, type OrderItem, Quote } from '../domain/quote';

export interface QuoteCheckoutCommand {
  readonly items: readonly OrderItem[];
}

export type QuoteCheckoutError =
  UnknownProduct | OutOfStock | InvalidTransaction | CheckoutUnavailable;

/**
 * Prices an order without placing it, for the cart and the summary screen.
 *
 * Reserves nothing. The buyer may still go back and change the quantities, and
 * holding stock for someone who is only looking would starve the buyers who
 * are actually paying. The quote is therefore advisory: the amount is fixed
 * only when the transaction is created, and checked against this one then.
 */
export class QuoteCheckout {
  constructor(
    private readonly inventory: InventoryPort,
    private readonly fees: Fees,
  ) {}

  execute(command: QuoteCheckoutCommand): ResultAsync<Quote, QuoteCheckoutError> {
    return ResultAsync.fromResult<readonly OrderItem[], QuoteCheckoutError>(
      Quote.checkItems(command.items),
    )
      .andThen((items) => this.inventory.offers(items.map((item) => item.productId)))
      .andThen((offers): Result<Quote, QuoteCheckoutError> => {
        const priced = command.items.map((item, index) => ({ item, offer: offers[index]! }));

        // The first short item, in the order the buyer listed them.
        const short = priced.find(({ item, offer }) => offer.availableUnits < item.units);
        if (short !== undefined) {
          return err(
            new OutOfStock(short.offer.productId, short.item.units, short.offer.availableUnits),
          );
        }

        return Quote.calculate({
          items: priced.map(({ item, offer }) => ({
            productId: offer.productId,
            name: offer.name,
            unitPriceInCents: offer.unitPriceInCents,
            currency: offer.currency,
            units: item.units,
          })),
          fees: this.fees,
        });
      });
  }
}
