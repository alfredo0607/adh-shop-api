import { type ClockPort, ResultAsync, err } from '../../../shared/domain';
import type {
  CheckoutUnavailable,
  PaymentGatewayUnavailable,
  PaymentRejected,
  ReservationExpired,
  TransactionNotFound,
  TransactionNotPayable,
} from '../domain/checkout.errors';
import type { PaymentGatewayPort } from '../domain/payment-gateway.port';
import type { Transaction } from '../domain/transaction';
import type { TransactionRepository } from '../domain/transaction.repository';

export interface PayTransactionCommand {
  readonly transactionId: string;
  /** Produced by the gateway from the card, in the buyer's browser. */
  readonly cardToken: string;
  readonly installments: number;
  readonly acceptanceToken: string;
  readonly personalDataAuthorizationToken: string;
}

export type PayTransactionError =
  | TransactionNotFound
  | TransactionNotPayable
  | ReservationExpired
  | PaymentRejected
  | PaymentGatewayUnavailable
  | CheckoutUnavailable;

/**
 * Sends a PENDING transaction to the payment gateway.
 *
 * The amount and the email come from the stored transaction, never from this
 * request: the only things the client contributes are the card token and its
 * acceptance of the terms.
 *
 * The outcome is not known when this returns. The gateway answers PENDING and
 * settles a few seconds later, so the transaction stays PENDING here and is
 * settled when the result is reported.
 */
export class PayTransaction {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly clock: ClockPort,
  ) {}

  execute(command: PayTransactionCommand): ResultAsync<Transaction, PayTransactionError> {
    return this.transactions
      .findById(command.transactionId)
      .andThen((transaction) => transaction.claimPayment(this.clock.now()))
      .andThen((claimed) => this.transactions.claimPayment(claimed))
      .andThen((claimed) => this.charge(claimed, command));
  }

  private charge(
    claimed: Transaction,
    command: PayTransactionCommand,
  ): ResultAsync<Transaction, PayTransactionError> {
    return this.gateway
      .charge({
        reference: claimed.reference,
        amountInCents: claimed.quote.totalInCents,
        currency: claimed.quote.currency,
        customerEmail: claimed.customer.email,
        cardToken: command.cardToken,
        installments: command.installments,
        acceptanceToken: command.acceptanceToken,
        personalDataAuthorizationToken: command.personalDataAuthorizationToken,
      })
      .orElse((error) => this.afterFailedCharge(claimed, error))
      .andThen((payment) =>
        this.transactions.update(
          claimed.recordGatewayPayment(payment.gatewayTransactionId, this.clock.now()),
        ),
      );
  }

  /**
   * A rejected request charged nothing, so the claim is released and the buyer
   * may try again with another card.
   *
   * An unreachable gateway is different: the request may or may not have been
   * processed, and releasing the claim could allow a second charge. The claim
   * stays, and the outcome is settled from the gateway's report, which carries
   * this transaction's reference.
   */
  private afterFailedCharge(
    claimed: Transaction,
    error: PaymentRejected | PaymentGatewayUnavailable,
  ): ResultAsync<never, PayTransactionError> {
    if (error.code !== 'PAYMENT_REJECTED') {
      return ResultAsync.err(error);
    }

    return this.transactions
      .update(claimed.releasePaymentClaim(this.clock.now()))
      .andThen(() => err<PayTransactionError, never>(error));
  }
}
