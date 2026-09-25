import { ResultAsync } from '../../../shared/domain';
import type {
  CheckoutUnavailable,
  DeliveryNotFound,
  TransactionNotFound,
} from '../domain/checkout.errors';
import type { Delivery } from '../domain/delivery';
import type { PaymentGatewayPort } from '../domain/payment-gateway.port';
import type { Transaction } from '../domain/transaction';
import type { DeliveryRepository, TransactionRepository } from '../domain/transaction.repository';
import type { SettleTransaction } from './settle-transaction.usecase';

/**
 * Reads a transaction back, which is how the storefront resumes after a
 * refresh: it keeps the id, and the server holds the truth about the rest.
 *
 * A PENDING transaction with a payment in flight is also checked against the
 * gateway before answering. The gateway's event is the primary signal, but it
 * can be late or lost; a buyer watching the screen should not wait on it.
 * If that check fails, the stored transaction is returned as it is — a read
 * must not fail because a third party is slow.
 */
export class FindTransaction {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly settle: SettleTransaction,
  ) {}

  execute(id: string): ResultAsync<Transaction, TransactionNotFound | CheckoutUnavailable> {
    return this.transactions.findById(id).andThen((transaction) => this.refresh(transaction));
  }

  private refresh(
    transaction: Transaction,
  ): ResultAsync<Transaction, TransactionNotFound | CheckoutUnavailable> {
    const gatewayTransactionId = transaction.gatewayTransactionId;

    if (transaction.isFinal || gatewayTransactionId === undefined) {
      return ResultAsync.ok(transaction);
    }

    return this.gateway
      .find(gatewayTransactionId)
      .andThen((payment) =>
        this.settle.applyTo(transaction, {
          reference: transaction.reference,
          gatewayTransactionId: payment.gatewayTransactionId,
          status: payment.status,
          amountInCents: payment.amountInCents,
        }),
      )
      .orElse(() => ResultAsync.ok<Transaction, never>(transaction));
  }
}

export class FindDelivery {
  constructor(private readonly deliveries: DeliveryRepository) {}

  execute(transactionId: string): ResultAsync<Delivery, DeliveryNotFound | CheckoutUnavailable> {
    return this.deliveries.findByTransactionId(transactionId);
  }
}
