import type { ResultAsync } from '../../../shared/domain';
import type { CheckoutUnavailable, TransactionNotFound } from '../domain/checkout.errors';
import type { Transaction } from '../domain/transaction';
import type { TransactionRepository } from '../domain/transaction.repository';

/**
 * Reads a transaction back, which is how the storefront resumes after a
 * refresh: it keeps the id, and the server holds the truth about the rest.
 */
export class FindTransaction {
  constructor(private readonly transactions: TransactionRepository) {}

  execute(id: string): ResultAsync<Transaction, TransactionNotFound | CheckoutUnavailable> {
    return this.transactions.findById(id);
  }
}
