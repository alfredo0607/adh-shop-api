import { type Result, err, ok } from '../../../shared/domain';

import { ReservationExpired, TransactionNotPayable } from './checkout.errors';
import type { Customer } from './customer';
import type { DeliveryAddress } from './delivery-address';
import type { Quote, QuoteLine } from './quote';

/**
 * PENDING until the payment gateway reports an outcome; every other status is
 * final. APPROVED to ERROR are the gateway's own terms and are kept as such, so
 * a status read back from it never has to be translated into a guess.
 *
 * EXPIRED is this service's: the reservation ran out with no payment made, and
 * the units went back on the shelf. The gateway never reports it.
 */
export type TransactionStatus =
  'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR' | 'EXPIRED';

/** Statuses the payment gateway can report. */
export type GatewayStatus = Exclude<TransactionStatus, 'EXPIRED'>;

interface TransactionState {
  readonly id: string;
  readonly status: TransactionStatus;
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
 * One attempt to buy an order: one or more products, paid together.
 *
 * Opened before the card is charged, holding reserved stock, so that two
 * buyers cannot both pay for the last unit. The reservation has a deadline: a
 * buyer who closes the tab must not keep the unit off the shelf forever.
 */
export class Transaction {
  private constructor(private readonly state: TransactionState) {}

  static open(input: {
    id: string;
    quote: Quote;
    customer: Customer;
    deliveryAddress: DeliveryAddress;
    now: Date;
    reservationTtlMs: number;
  }): Transaction {
    return new Transaction({
      id: input.id,
      status: 'PENDING',
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

  /** The products bought, priced as they were when the units were reserved. */
  get lines(): readonly QuoteLine[] {
    return this.state.quote.lines;
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

  /**
   * Applies the outcome the gateway reported.
   *
   * Returns `undefined` when there is nothing to change: the outcome is still
   * PENDING, or it was already applied. Gateways deliver events at least once,
   * and the same outcome also arrives through polling, so a repeat is normal
   * and must be harmless. A final status is never overwritten by another.
   */
  settle(
    outcome: TransactionStatus,
    now: Date,
    gatewayTransactionId?: string,
  ): Transaction | undefined {
    if (outcome === 'PENDING' || this.isFinal) {
      return undefined;
    }

    return this.with({
      status: outcome,
      updatedAt: now,
      // Filled in when the charge call timed out before returning the id,
      // and the outcome arrived by other means.
      gatewayTransactionId: this.gatewayTransactionId ?? gatewayTransactionId,
    });
  }

  /**
   * Closes a reservation that ran out without a payment.
   *
   * A transaction with a payment in flight is never expired on the clock
   * alone: the charge may be about to succeed, and expiring it would return
   * units the buyer has paid for. It expires only once the caller has
   * established that the attempt came to nothing (`paymentAbandoned`).
   */
  expire(now: Date, options: { paymentAbandoned?: boolean } = {}): Transaction | undefined {
    const deadlinePassed = now.getTime() >= this.reservationExpiresAt.getTime();
    const nothingInFlight = !this.paymentSubmitted || options.paymentAbandoned === true;

    if (this.isFinal || !deadlinePassed || !nothingInFlight) {
      return undefined;
    }

    return this.with({ status: 'EXPIRED', updatedAt: now });
  }

  private with(changes: Partial<TransactionState>): Transaction {
    return new Transaction({ ...this.state, ...changes, version: this.state.version + 1 });
  }
}
