import { type Result, err, ok } from '../../../shared/domain';

import { InvalidTransaction } from './checkout.errors';

export interface Fees {
  readonly baseFeeInCents: number;
  readonly deliveryFeeInCents: number;
}

/** What the buyer asks for: some units of one product. */
export interface OrderItem {
  readonly productId: string;
  readonly units: number;
}

/** One product of an order, priced. */
export interface QuoteLine {
  readonly productId: string;
  readonly name: string;
  readonly unitPriceInCents: number;
  readonly units: number;
  readonly lineTotalInCents: number;
}

type PricedItem = Omit<QuoteLine, 'lineTotalInCents'> & { readonly currency: string };

/**
 * What the buyer pays, broken down the way the summary screen shows it: one
 * line per product, their sum, and the fees, which are charged once per order
 * however many products it holds.
 *
 * Always computed here, never accepted from the client. A total that arrives
 * in a request body is a total the buyer can edit in the browser console.
 *
 * Integer cents throughout, for the reason given on Money in the catalogue.
 */
export class Quote {
  /** One order is one household purchase, not a wholesale lot. */
  static readonly MAX_UNITS = 10;

  /**
   * Distinct products per order. Also keeps the settlement, which writes the
   * order, every product and the delivery in one DynamoDB transaction, far
   * below that transaction's limit of 100 operations.
   */
  static readonly MAX_ITEMS = 10;

  private constructor(
    readonly lines: readonly QuoteLine[],
    /** The sum of every line: what the products cost, before fees. */
    readonly productInCents: number,
    readonly baseFeeInCents: number,
    readonly deliveryFeeInCents: number,
    readonly totalInCents: number,
    readonly currency: string,
  ) {}

  /** Units across every line. */
  get units(): number {
    return this.lines.reduce((sum, line) => sum + line.units, 0);
  }

  /**
   * Checked on its own so a use case can reject a bad order before it reserves
   * anything, rather than reserving and then undoing.
   */
  static checkItems(items: readonly OrderItem[]): Result<readonly OrderItem[], InvalidTransaction> {
    if (items.length === 0 || items.length > Quote.MAX_ITEMS) {
      return err(
        new InvalidTransaction(`An order holds between 1 and ${Quote.MAX_ITEMS} products`, {
          items: items.length,
        }),
      );
    }

    if (new Set(items.map((item) => item.productId)).size !== items.length) {
      return err(new InvalidTransaction('Each product may appear only once in an order'));
    }

    const invalid = items.find(
      (item) => !Number.isInteger(item.units) || item.units < 1 || item.units > Quote.MAX_UNITS,
    );
    if (invalid !== undefined) {
      return err(
        new InvalidTransaction(`Units must be a whole number between 1 and ${Quote.MAX_UNITS}`, {
          productId: invalid.productId,
          units: invalid.units,
        }),
      );
    }

    return ok(items);
  }

  static calculate(input: {
    items: readonly PricedItem[];
    fees: Fees;
  }): Result<Quote, InvalidTransaction> {
    const { items, fees } = input;

    const amounts = [
      ...items.map((item) => item.unitPriceInCents),
      fees.baseFeeInCents,
      fees.deliveryFeeInCents,
    ];
    if (amounts.some((amount) => !Number.isInteger(amount) || amount < 0)) {
      return err(new InvalidTransaction('Amounts must be non-negative whole cents'));
    }

    const currencies = new Set(items.map((item) => item.currency));
    if (currencies.size > 1) {
      return err(new InvalidTransaction('Every product in an order must share one currency'));
    }

    return Quote.checkItems(items).map(() => {
      const lines = items.map(({ productId, name, unitPriceInCents, units }): QuoteLine => ({
        productId,
        name,
        unitPriceInCents,
        units,
        lineTotalInCents: unitPriceInCents * units,
      }));
      const productInCents = lines.reduce((sum, line) => sum + line.lineTotalInCents, 0);

      return new Quote(
        lines,
        productInCents,
        fees.baseFeeInCents,
        fees.deliveryFeeInCents,
        productInCents + fees.baseFeeInCents + fees.deliveryFeeInCents,
        items[0]!.currency,
      );
    });
  }

  /**
   * Rebuilds a stored quote exactly as it was charged. Recomputing it from the
   * current fees would silently rewrite what past buyers paid.
   */
  static restore(input: {
    lines: readonly QuoteLine[];
    productInCents: number;
    baseFeeInCents: number;
    deliveryFeeInCents: number;
    totalInCents: number;
    currency: string;
  }): Quote {
    return new Quote(
      input.lines,
      input.productInCents,
      input.baseFeeInCents,
      input.deliveryFeeInCents,
      input.totalInCents,
      input.currency,
    );
  }
}
