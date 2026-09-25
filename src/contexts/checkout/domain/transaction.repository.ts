import type { ResultAsync } from '../../../shared/domain';

import type {
  CheckoutUnavailable,
  TransactionNotFound,
  TransactionNotPayable,
} from './checkout.errors';
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
}

export const TRANSACTION_REPOSITORY = Symbol('TransactionRepository');
