import { type ClockPort, ResultAsync } from '../../../shared/domain';
import {
  type CheckoutUnavailable,
  SettlementAmountMismatch,
  type SettlementConflict,
  type TransactionNotFound,
} from '../domain/checkout.errors';
import { Delivery } from '../domain/delivery';
import type { GatewayStatus, Transaction } from '../domain/transaction';
import type { TransactionRepository } from '../domain/transaction.repository';

export interface PaymentOutcome {
  /** Our transaction id, sent to the gateway as the payment reference. */
  readonly reference: string;
  readonly gatewayTransactionId: string;
  readonly status: GatewayStatus;
  readonly amountInCents: number;
}

export type SettleTransactionError =
  TransactionNotFound | SettlementAmountMismatch | CheckoutUnavailable;

/**
 * Applies a payment outcome reported by the gateway: approves or closes the
 * transaction, moves the stock accordingly, and creates the delivery.
 *
 * Reached from two directions — the gateway's event, and a buyer polling a
 * PENDING transaction — often for the same outcome, sometimes at the same
 * moment. Both are safe: a repeated outcome changes nothing, and when two
 * writers race, the loser re-reads and returns what the winner stored.
 */
export class SettleTransaction {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly clock: ClockPort,
  ) {}

  execute(outcome: PaymentOutcome): ResultAsync<Transaction, SettleTransactionError> {
    return this.transactions
      .findById(outcome.reference)
      .andThen((transaction) => this.applyTo(transaction, outcome));
  }

  applyTo(
    transaction: Transaction,
    outcome: PaymentOutcome,
  ): ResultAsync<Transaction, SettleTransactionError> {
    if (outcome.status === 'APPROVED' && outcome.amountInCents !== transaction.quote.totalInCents) {
      return ResultAsync.err(
        new SettlementAmountMismatch(
          transaction.id,
          transaction.quote.totalInCents,
          outcome.amountInCents,
        ),
      );
    }

    const now = this.clock.now();
    const settled = transaction.settle(outcome.status, now, outcome.gatewayTransactionId);

    if (settled === undefined) {
      return ResultAsync.ok(transaction);
    }

    const delivery = settled.status === 'APPROVED' ? Delivery.forApproved(settled, now) : undefined;

    return this.transactions
      .saveSettlement(settled, delivery)
      .orElse((error: SettlementConflict | CheckoutUnavailable) =>
        error.code === 'SETTLEMENT_CONFLICT'
          ? this.transactions.findById(transaction.id)
          : ResultAsync.err(error),
      );
  }
}
