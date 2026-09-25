import type { ResultAsync } from '../../../shared/domain';

import type { CheckoutUnavailable, TransactionNotFound } from './checkout.errors';
import type { Transaction } from './transaction';

export interface TransactionRepository {
  /** Stores a new transaction. Never overwrites one with the same id. */
  create(transaction: Transaction): ResultAsync<Transaction, CheckoutUnavailable>;

  findById(id: string): ResultAsync<Transaction, TransactionNotFound | CheckoutUnavailable>;
}

export const TRANSACTION_REPOSITORY = Symbol('TransactionRepository');
