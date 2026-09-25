import type { ResultAsync } from '../../../shared/domain';

import type {
  CheckoutUnavailable,
  DeliveryNotFound,
  SettlementConflict,
  TransactionNotFound,
  TransactionNotPayable,
} from './checkout.errors';
import type { Delivery } from './delivery';
import type { Transaction } from './transaction';

export interface TransactionRepository {
  /** Stores a new transaction. Never overwrites one with the same id. */
  create(transaction: Transaction): ResultAsync<Transaction, CheckoutUnavailable>;

  findById(id: string): ResultAsync<Transaction, TransactionNotFound | CheckoutUnavailable>;

  /**
   * Records a payment claim, but only if nobody claimed it first.
   *
   * The entity already refuses a second claim, but two requests can both load
   * the unclaimed transaction before either writes. The store settles that
   * race: exactly one conditional write succeeds, and the loser is told the
   * transaction is no longer payable.
   */
  claimPayment(
    transaction: Transaction,
  ): ResultAsync<Transaction, TransactionNotPayable | CheckoutUnavailable>;

  /** Persists a change to a transaction that has already been claimed. */
  update(transaction: Transaction): ResultAsync<Transaction, CheckoutUnavailable>;

  /**
   * Writes a final outcome and everything that follows from it, atomically.
   *
   * APPROVED confirms the reserved units as sold and creates the delivery; any
   * other final status returns the units to the shelf. All of it happens in
   * one write or not at all: an approval whose stock step failed would leave
   * units reserved forever, and one without its delivery would take money for
   * nothing.
   */
  saveSettlement(
    settled: Transaction,
    delivery: Delivery | undefined,
  ): ResultAsync<Transaction, SettlementConflict | CheckoutUnavailable>;

  /**
   * PENDING transactions whose reservation deadline has passed, oldest first.
   * `after` continues from the last transaction of a previous page.
   */
  findExpiredReservations(
    now: Date,
    limit: number,
    after?: Transaction,
  ): ResultAsync<Transaction[], CheckoutUnavailable>;
}

export const TRANSACTION_REPOSITORY = Symbol('TransactionRepository');

export interface DeliveryRepository {
  findByTransactionId(
    transactionId: string,
  ): ResultAsync<Delivery, DeliveryNotFound | CheckoutUnavailable>;
}

export const DELIVERY_REPOSITORY = Symbol('DeliveryRepository');
