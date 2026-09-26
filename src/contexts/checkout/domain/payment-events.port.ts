import type { Delivery } from './delivery';
import type { Transaction } from './transaction';

export const PAYMENT_EVENTS_PORT = Symbol('PaymentEventsPort');

/** A payment reached its final status. Sent once, by the writer that stored it. */
export interface PaymentSettled {
  readonly transaction: Transaction;
  /** Present when the payment was approved. */
  readonly delivery?: Delivery | undefined;
  readonly occurredAt: Date;
}

/**
 * Tells the rest of the platform about payments, today so the buyer gets an
 * email.
 *
 * Best effort by contract: `settled` never rejects. The payment is already
 * stored when it is called, and failing the buyer's request because a
 * notification could not be sent would report a successful payment as an
 * error. An adapter that cannot publish logs the failure and resolves.
 */
export interface PaymentEventsPort {
  settled(event: PaymentSettled): Promise<void>;
}

/** Publishes nothing. For environments with no queue configured, and for tests. */
export const NO_PAYMENT_EVENTS: PaymentEventsPort = {
  settled: () => Promise.resolve(),
};
