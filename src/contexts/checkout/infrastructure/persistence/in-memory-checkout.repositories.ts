import { ResultAsync, err } from '../../../../shared/domain';
import { type CheckoutUnavailable, TransactionNotFound } from '../../domain/checkout.errors';
import { Customer, type CustomerDetails } from '../../domain/customer';
import type { CustomerRepository } from '../../domain/customer.repository';
import type { Transaction } from '../../domain/transaction';
import type { TransactionRepository } from '../../domain/transaction.repository';

/**
 * In-memory implementations for tests. Real behaviour rather than mocks, for
 * the reason given on the catalogue's in-memory repository.
 */
export class InMemoryCustomerRepository implements CustomerRepository {
  readonly byEmail = new Map<string, Customer>();

  register(details: CustomerDetails, newId: string): ResultAsync<Customer, CheckoutUnavailable> {
    const id = this.byEmail.get(details.email)?.id ?? newId;
    const customer = Customer.restore({ ...details, id });

    this.byEmail.set(details.email, customer);

    return ResultAsync.ok(customer);
  }
}

export class InMemoryTransactionRepository implements TransactionRepository {
  readonly byId = new Map<string, Transaction>();

  create(transaction: Transaction): ResultAsync<Transaction, CheckoutUnavailable> {
    this.byId.set(transaction.id, transaction);

    return ResultAsync.ok(transaction);
  }

  findById(id: string): ResultAsync<Transaction, TransactionNotFound | CheckoutUnavailable> {
    const transaction = this.byId.get(id);

    return transaction === undefined
      ? ResultAsync.fromResult(err(new TransactionNotFound(id)))
      : ResultAsync.ok(transaction);
  }
}
