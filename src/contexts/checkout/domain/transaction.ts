import type { Customer } from './customer';
import type { DeliveryAddress } from './delivery-address';
import type { Quote } from './quote';

/**
 * PENDING until the payment gateway reports an outcome; every other status is
 * final. VOIDED and ERROR are the gateway's own terms and are kept as such, so
 * a status read back from it never has to be translated into a guess.
 */
export type TransactionStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';

export interface PurchasedProduct {
  readonly id: string;
  readonly name: string;
}

/**
 * One attempt to buy a product.
 *
 * Opened before the card is charged, holding reserved stock, so that two
 * buyers cannot both pay for the last unit. The reservation has a deadline: a
 * buyer who closes the tab must not keep the unit off the shelf forever.
 */
export class Transaction {
  private constructor(
    readonly id: string,
    readonly status: TransactionStatus,
    readonly product: PurchasedProduct,
    readonly quote: Quote,
    readonly customer: Customer,
    readonly deliveryAddress: DeliveryAddress,
    readonly createdAt: Date,
    readonly updatedAt: Date,
    readonly reservationExpiresAt: Date,
    readonly version: number,
  ) {}

  static open(input: {
    id: string;
    product: PurchasedProduct;
    quote: Quote;
    customer: Customer;
    deliveryAddress: DeliveryAddress;
    now: Date;
    reservationTtlMs: number;
  }): Transaction {
    return new Transaction(
      input.id,
      'PENDING',
      input.product,
      input.quote,
      input.customer,
      input.deliveryAddress,
      input.now,
      input.now,
      new Date(input.now.getTime() + input.reservationTtlMs),
      0,
    );
  }

  static restore(input: {
    id: string;
    status: TransactionStatus;
    product: PurchasedProduct;
    quote: Quote;
    customer: Customer;
    deliveryAddress: DeliveryAddress;
    createdAt: Date;
    updatedAt: Date;
    reservationExpiresAt: Date;
    version: number;
  }): Transaction {
    return new Transaction(
      input.id,
      input.status,
      input.product,
      input.quote,
      input.customer,
      input.deliveryAddress,
      input.createdAt,
      input.updatedAt,
      input.reservationExpiresAt,
      input.version,
    );
  }

  get isFinal(): boolean {
    return this.status !== 'PENDING';
  }

  /**
   * The id doubles as the reference sent to the payment gateway. It is unique
   * by construction, so there is no second identifier to keep in step.
   */
  get reference(): string {
    return this.id;
  }
}
