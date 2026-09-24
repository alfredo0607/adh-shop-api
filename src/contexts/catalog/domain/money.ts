import { type Result, err, ok } from '../../../shared/domain';

import { InvalidMoney } from './catalog.errors';

/**
 * An amount of money, held as an integer number of minor units.
 *
 * Never a floating point number. `0.1 + 0.2` is `0.30000000000000004`, and a
 * checkout that adds a product price to a base fee and a delivery fee does
 * exactly that kind of arithmetic. Cents in, cents out, and the presentation
 * layer divides once at the very end.
 *
 * The payment gateway also speaks in cents, so keeping the domain in the same
 * unit removes a conversion — and conversions are where rounding errors are
 * introduced.
 */
export class Money {
  private constructor(
    readonly amountInCents: number,
    readonly currency: string,
  ) {}

  static create(amountInCents: number, currency: string): Result<Money, InvalidMoney> {
    if (!Number.isInteger(amountInCents)) {
      return err(
        new InvalidMoney('Amount must be an integer number of cents', {
          received: amountInCents,
        }),
      );
    }

    if (amountInCents < 0) {
      return err(new InvalidMoney('Amount cannot be negative', { received: amountInCents }));
    }

    if (currency.length !== 3) {
      return err(new InvalidMoney('Currency must be an ISO 4217 code', { received: currency }));
    }

    return ok(new Money(amountInCents, currency.toUpperCase()));
  }

  /**
   * Adding two amounts in different currencies is meaningless, so it is an
   * error rather than a silent coercion.
   */
  add(other: Money): Result<Money, InvalidMoney> {
    if (other.currency !== this.currency) {
      return err(
        new InvalidMoney('Cannot add amounts in different currencies', {
          left: this.currency,
          right: other.currency,
        }),
      );
    }

    return ok(new Money(this.amountInCents + other.amountInCents, this.currency));
  }

  multiply(factor: number): Result<Money, InvalidMoney> {
    if (!Number.isInteger(factor) || factor < 0) {
      return err(new InvalidMoney('Factor must be a non-negative integer', { received: factor }));
    }

    return ok(new Money(this.amountInCents * factor, this.currency));
  }

  equals(other: Money): boolean {
    return this.amountInCents === other.amountInCents && this.currency === other.currency;
  }
}
