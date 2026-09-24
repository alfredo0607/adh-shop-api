import { type Result, err, ok } from '../../../shared/domain';

import { InsufficientStock, InvalidStock } from './catalog.errors';

/**
 * Units of a product, split between what can still be sold and what is held
 * for a checkout in progress.
 *
 * Two counters rather than one, because a single one cannot be correct at both
 * ends of the payment. Decrementing only once the payment is approved lets two
 * buyers pass the availability check for the same last unit and both succeed —
 * the gateway call takes seconds, and that is a very wide window. Decrementing
 * when the checkout starts avoids the oversell but loses the unit permanently
 * whenever a payment is declined or a browser is closed.
 *
 * So the unit moves in two steps:
 *
 *   reserve   available -> reserved   (checkout starts)
 *   confirm   reserved  -> sold       (payment approved)
 *   release   reserved  -> available  (payment declined, or abandoned)
 *
 * Every transition is total: it either produces a valid Stock or an error, and
 * there is no way to construct one that breaks the invariant. The class is
 * immutable, so a caller cannot hold a reference and watch it change underneath.
 */
export class Stock {
  private constructor(
    readonly available: number,
    readonly reserved: number,
  ) {}

  static create(available: number, reserved = 0): Result<Stock, InvalidStock> {
    if (!Number.isInteger(available) || !Number.isInteger(reserved)) {
      return err(new InvalidStock('Stock counts must be integers', { available, reserved }));
    }

    if (available < 0 || reserved < 0) {
      return err(new InvalidStock('Stock counts cannot be negative', { available, reserved }));
    }

    return ok(new Stock(available, reserved));
  }

  /** Total units accounted for, whether sellable or held. */
  get total(): number {
    return this.available + this.reserved;
  }

  get isSoldOut(): boolean {
    return this.available === 0;
  }

  /**
   * Holds units for a checkout in progress.
   *
   * Returns InsufficientStock rather than clamping to what is available.
   * Silently reserving fewer units than asked for would let a customer pay for
   * three and receive one, which is worse than being told to try again.
   */
  reserve(units: number): Result<Stock, InsufficientStock | InvalidStock> {
    const validUnits = this.requirePositive(units);
    if (validUnits.isErr()) {
      return err(validUnits.error);
    }

    if (units > this.available) {
      return err(new InsufficientStock(units, this.available));
    }

    return ok(new Stock(this.available - units, this.reserved + units));
  }

  /**
   * Turns a reservation into a sale. The units leave the product entirely.
   *
   * Guarded against confirming more than is held: without the check, a repeated
   * confirmation would drive `reserved` negative and quietly manufacture stock
   * that was never there.
   */
  confirm(units: number): Result<Stock, InsufficientStock | InvalidStock> {
    const validUnits = this.requirePositive(units);
    if (validUnits.isErr()) {
      return err(validUnits.error);
    }

    if (units > this.reserved) {
      return err(new InsufficientStock(units, this.reserved));
    }

    return ok(new Stock(this.available, this.reserved - units));
  }

  /**
   * Returns held units to the shelf, after a declined payment or an abandoned
   * checkout.
   */
  release(units: number): Result<Stock, InsufficientStock | InvalidStock> {
    const validUnits = this.requirePositive(units);
    if (validUnits.isErr()) {
      return err(validUnits.error);
    }

    if (units > this.reserved) {
      return err(new InsufficientStock(units, this.reserved));
    }

    return ok(new Stock(this.available + units, this.reserved - units));
  }

  private requirePositive(units: number): Result<number, InvalidStock> {
    if (!Number.isInteger(units) || units <= 0) {
      return err(new InvalidStock('Unit count must be a positive integer', { units }));
    }

    return ok(units);
  }
}
