import { ResultAsync, err, type Result } from '../../../shared/domain';
import {
  type CheckoutUnavailable,
  type InvalidTransaction,
  OutOfStock,
  type UnknownProduct,
} from '../domain/checkout.errors';
import type { InventoryPort } from '../domain/inventory.port';
import { type Fees, Quote } from '../domain/quote';

export interface QuoteCheckoutCommand {
  readonly productId: string;
  readonly units: number;
}

export type QuoteCheckoutError =
  UnknownProduct | OutOfStock | InvalidTransaction | CheckoutUnavailable;

/**
 * Prices an order without placing it, for the summary screen.
 *
 * Reserves nothing. The buyer may still go back and change the quantity, and
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
    return ResultAsync.fromResult<number, QuoteCheckoutError>(Quote.checkUnits(command.units))
      .andThen(() => this.inventory.offer(command.productId))
      .andThen((offer): Result<Quote, QuoteCheckoutError> => {
        if (offer.availableUnits < command.units) {
          return err(new OutOfStock(offer.productId, command.units, offer.availableUnits));
        }

        return Quote.calculate({
          unitPriceInCents: offer.unitPriceInCents,
          units: command.units,
          currency: offer.currency,
          fees: this.fees,
        });
      });
  }
}
