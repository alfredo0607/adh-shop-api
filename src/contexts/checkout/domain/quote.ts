import { type Result, err, ok } from '../../../shared/domain';

import { InvalidTransaction } from './checkout.errors';

export interface Fees {
  readonly baseFeeInCents: number;
  readonly deliveryFeeInCents: number;
}

/**
 * What the buyer pays, broken down the way the summary screen shows it.
 *
 * Always computed here, never accepted from the client. A total that arrives
 * in a request body is a total the buyer can edit in the browser console.
 *
 * Integer cents throughout, for the reason given on Money in the catalogue.
 */
export class Quote {
  /** One order is one household purchase, not a wholesale lot. */
  static readonly MAX_UNITS = 10;

  private constructor(
    readonly unitPriceInCents: number,
    readonly units: number,
    readonly productInCents: number,
    readonly baseFeeInCents: number,
    readonly deliveryFeeInCents: number,
    readonly totalInCents: number,
    readonly currency: string,
  ) {}

  /**
   * Checked on its own so a use case can reject a bad quantity before it
   * reserves anything, rather than reserving and then undoing.
   */
  static checkUnits(units: number): Result<number, InvalidTransaction> {
    if (!Number.isInteger(units) || units < 1 || units > Quote.MAX_UNITS) {
      return err(
        new InvalidTransaction(`Units must be a whole number between 1 and ${Quote.MAX_UNITS}`, {
          units,
        }),
      );
    }

    return ok(units);
  }

  static calculate(input: {
    unitPriceInCents: number;
    units: number;
    currency: string;
    fees: Fees;
  }): Result<Quote, InvalidTransaction> {
    const { unitPriceInCents, units, currency, fees } = input;

    const amounts = [unitPriceInCents, fees.baseFeeInCents, fees.deliveryFeeInCents];
    if (amounts.some((amount) => !Number.isInteger(amount) || amount < 0)) {
      return err(new InvalidTransaction('Amounts must be non-negative whole cents'));
    }

    return Quote.checkUnits(units).map((checked) => {
      const productInCents = unitPriceInCents * checked;

      return new Quote(
        unitPriceInCents,
        checked,
        productInCents,
        fees.baseFeeInCents,
        fees.deliveryFeeInCents,
        productInCents + fees.baseFeeInCents + fees.deliveryFeeInCents,
        currency,
      );
    });
  }

  /**
   * Rebuilds a stored quote exactly as it was charged. Recomputing it from the
   * current fees would silently rewrite what past buyers paid.
   */
  static restore(input: {
    unitPriceInCents: number;
    units: number;
    productInCents: number;
    baseFeeInCents: number;
    deliveryFeeInCents: number;
    totalInCents: number;
    currency: string;
  }): Quote {
    return new Quote(
      input.unitPriceInCents,
      input.units,
      input.productInCents,
      input.baseFeeInCents,
      input.deliveryFeeInCents,
      input.totalInCents,
      input.currency,
    );
  }
}
