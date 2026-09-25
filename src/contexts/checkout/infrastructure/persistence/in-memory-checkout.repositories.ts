import { ResultAsync, err } from '../../../../shared/domain';
import type { ProductRepository } from '../../../catalog/domain/product.repository';
import {
  CheckoutUnavailable,
  DeliveryNotFound,
  SettlementConflict,
  TransactionNotFound,
  TransactionNotPayable,
} from '../../domain/checkout.errors';
import { Customer, type CustomerDetails } from '../../domain/customer';
import type { CustomerRepository } from '../../domain/customer.repository';
import type { Delivery } from '../../domain/delivery';
import type { Transaction } from '../../domain/transaction';
import type {
  DeliveryRepository,
  TransactionRepository,
} from '../../domain/transaction.repository';

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

/**
 * Given the catalogue's in-memory repository, a settlement also moves the
 * stock, as the DynamoDB transaction does. Without one, stock is left alone.
 */
export class InMemoryTransactionRepository implements TransactionRepository, DeliveryRepository {
  readonly byId = new Map<string, Transaction>();
  readonly deliveries = new Map<string, Delivery>();

  constructor(private readonly products?: ProductRepository) {}

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

  claimPayment(
    transaction: Transaction,
  ): ResultAsync<Transaction, TransactionNotPayable | CheckoutUnavailable> {
    const stored = this.byId.get(transaction.id);

    if (stored === undefined || stored.isFinal || stored.paymentSubmitted) {
      return ResultAsync.fromResult(
        err(new TransactionNotPayable(transaction.id, 'ALREADY_SUBMITTED')),
      );
    }

    this.byId.set(transaction.id, transaction);
    return ResultAsync.ok(transaction);
  }

  update(transaction: Transaction): ResultAsync<Transaction, CheckoutUnavailable> {
    if (this.byId.get(transaction.id)?.version !== transaction.version - 1) {
      return ResultAsync.err(new CheckoutUnavailable('The transaction changed concurrently'));
    }

    this.byId.set(transaction.id, transaction);
    return ResultAsync.ok(transaction);
  }

  saveSettlement(
    settled: Transaction,
    delivery: Delivery | undefined,
  ): ResultAsync<Transaction, SettlementConflict | CheckoutUnavailable> {
    const stored = this.byId.get(settled.id);

    if (stored === undefined || stored.isFinal || stored.version !== settled.version - 1) {
      return ResultAsync.err(new SettlementConflict(settled.id));
    }

    return this.moveStock(settled).map(() => {
      this.byId.set(settled.id, settled);
      if (delivery !== undefined) {
        this.deliveries.set(settled.id, delivery);
      }
      return settled;
    });
  }

  findExpiredReservations(
    now: Date,
    limit: number,
    after?: Transaction,
  ): ResultAsync<Transaction[], CheckoutUnavailable> {
    // Ordered as the index orders them: by deadline, then by key.
    const order = (t: Transaction): string => `${t.reservationExpiresAt.toISOString()}|${t.id}`;

    const expired = [...this.byId.values()]
      .filter((t) => !t.isFinal && t.reservationExpiresAt.getTime() < now.getTime())
      .filter((t) => after === undefined || order(t) > order(after))
      .sort((a, b) => order(a).localeCompare(order(b)))
      .slice(0, limit);

    return ResultAsync.ok(expired);
  }

  findByTransactionId(
    transactionId: string,
  ): ResultAsync<Delivery, DeliveryNotFound | CheckoutUnavailable> {
    const delivery = this.deliveries.get(transactionId);

    return delivery === undefined
      ? ResultAsync.err(new DeliveryNotFound(transactionId))
      : ResultAsync.ok(delivery);
  }

  private moveStock(settled: Transaction): ResultAsync<unknown, CheckoutUnavailable> {
    if (this.products === undefined) {
      return ResultAsync.ok(undefined);
    }

    const { id } = settled.product;
    const { units } = settled.quote;
    const moved =
      settled.status === 'APPROVED'
        ? this.products.confirmUnits(id, units)
        : this.products.releaseUnits(id, units);

    return moved.mapErr((cause) => new CheckoutUnavailable('Stock could not move', cause));
  }
}
