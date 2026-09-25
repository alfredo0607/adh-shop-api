import { type Result, err, ok } from '../../../shared/domain';

import { ReservationExpired, TransactionNotPayable } from './checkout.errors';
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

interface TransactionState {
  readonly id: string;
  readonly status: TransactionStatus;
  readonly product: PurchasedProduct;
  readonly quote: Quote;
  readonly customer: Customer;
  readonly deliveryAddress: DeliveryAddress;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly reservationExpiresAt: Date;
  /** Set the moment a payment attempt starts, before the gateway is called. */
  readonly paymentClaimedAt?: Date | undefined;
  /** The gateway's id for the payment, once it has accepted the request. */
  readonly gatewayTransactionId?: string | undefined;
  readonly version: number;
}

/**
 * One attempt to buy a product.
 *
 * Opened before the card is charged, holding reserved stock, so that two
 * buyers cannot both pay for the last unit. The reservation has a deadline: a
 * buyer who closes the tab must not keep the unit off the shelf forever.
 */
export class Transaction {
  private constructor(private readonly state: TransactionState) {}

  static open(input: {
    id: string;
    product: PurchasedProduct;
    quote: Quote;
    customer: Customer;
    deliveryAddress: DeliveryAddress;
    now: Date;
    reservationTtlMs: number;
  }): Transaction {
    return new Transaction({
      id: input.id,
      status: 'PENDING',
      product: input.product,
      quote: input.quote,
      customer: input.customer,
      deliveryAddress: input.deliveryAddress,
      createdAt: input.now,
      updatedAt: input.now,
      reservationExpiresAt: new Date(input.now.getTime() + input.reservationTtlMs),
      version: 0,
    });
  }

  static restore(state: TransactionState): Transaction {
    return new Transaction(state);
  }

  get id(): string {
    return this.state.id;
  }

  get status(): TransactionStatus {
    return this.state.status;
  }

  get product(): PurchasedProduct {
    return this.state.product;
  }

  get quote(): Quote {
    return this.state.quote;
  }

  get customer(): Customer {
    return this.state.customer;
  }

  get deliveryAddress(): DeliveryAddress {
    return this.state.deliveryAddress;
  }

  get createdAt(): Date {
    return this.state.createdAt;
  }

  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  get reservationExpiresAt(): Date {
    return this.state.reservationExpiresAt;
  }

  get paymentClaimedAt(): Date | undefined {
    return this.state.paymentClaimedAt;
  }

  get gatewayTransactionId(): string | undefined {
    return this.state.gatewayTransactionId;
  }

  get version(): number {
    return this.state.version;
  }

  get isFinal(): boolean {
    return this.state.status !== 'PENDING';
  }

  get paymentSubmitted(): boolean {
    return this.state.paymentClaimedAt !== undefined;
  }

  /**
   * The id doubles as the reference sent to the payment gateway. It is unique
   * by construction, so there is no second identifier to keep in step.
   */
  get reference(): string {
    return this.state.id;
  }

  /**
   * Marks the start of the one payment attempt this transaction allows.
   *
   * Claimed before the gateway is called, not after. Recording the attempt
   * only once the gateway answers leaves a window in which a second request —
   * a double tap, a retry after a timeout — would charge the card again.
   */
  claimPayment(now: Date): Result<Transaction, TransactionNotPayable | ReservationExpired> {
    if (this.isFinal) {
      return err(new TransactionNotPayable(this.id, 'FINAL'));
    }

    if (this.paymentSubmitted) {
      return err(new TransactionNotPayable(this.id, 'ALREADY_SUBMITTED'));
    }

    if (now.getTime() >= this.reservationExpiresAt.getTime()) {
      return err(new ReservationExpired(this.id, this.reservationExpiresAt));
    }

    return ok(this.with({ paymentClaimedAt: now, updatedAt: now }));
  }

  /** The gateway accepted the request; its outcome arrives later. */
  recordGatewayPayment(gatewayTransactionId: string, now: Date): Transaction {
    return this.with({ gatewayTransactionId, updatedAt: now });
  }

  /**
   * Undoes a claim when the gateway refused the request outright, so the buyer
   * can fix the card and try again. Only valid while nothing was charged.
   */
  releasePaymentClaim(now: Date): Transaction {
    return this.with({ paymentClaimedAt: undefined, updatedAt: now });
  }

  private with(changes: Partial<TransactionState>): Transaction {
    return new Transaction({ ...this.state, ...changes, version: this.state.version + 1 });
  }
}
