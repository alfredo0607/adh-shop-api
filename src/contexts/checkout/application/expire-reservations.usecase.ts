import { type ClockPort, ResultAsync } from '../../../shared/domain';
import type { CheckoutUnavailable } from '../domain/checkout.errors';
import type { PaymentGatewayPort } from '../domain/payment-gateway.port';
import type { Transaction } from '../domain/transaction';
import type { TransactionRepository } from '../domain/transaction.repository';
import type { SettleTransaction } from './settle-transaction.usecase';

export interface ExpirySummary {
  /** Closed as EXPIRED, units returned to stock. */
  readonly expired: number;
  /** Had a payment after all; closed with the gateway's outcome. */
  readonly settled: number;
  /** Left for the next run: payment still in flight, or a transient failure. */
  readonly deferred: number;
}

type Outcome = keyof ExpirySummary;

/**
 * Returns the units of abandoned checkouts to the shelf.
 *
 * Runs on a schedule. Each overdue reservation is handled on its own, so one
 * that cannot be resolved now — the gateway is slow, a write lost a race —
 * is simply retried on the next run instead of blocking the rest.
 */
export class ExpireReservations {
  /** How many overdue reservations one run handles. The next run takes the rest. */
  static readonly BATCH_SIZE = 25;

  /**
   * How long a claimed payment with no trace at the gateway is given before it
   * is treated as never having happened. The charge call has long timed out by
   * then; this covers the gateway being slow to make a new payment searchable.
   */
  static readonly ABANDONED_CLAIM_MS = 10 * 60_000;

  constructor(
    private readonly transactions: TransactionRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly settle: SettleTransaction,
    private readonly clock: ClockPort,
  ) {}

  execute(): ResultAsync<ExpirySummary, CheckoutUnavailable> {
    return this.transactions
      .findExpiredReservations(this.clock.now(), ExpireReservations.BATCH_SIZE)
      .andThen((overdue) => ResultAsync.fromSafePromise(this.resolveAll(overdue)));
  }

  private async resolveAll(overdue: Transaction[]): Promise<ExpirySummary> {
    const summary: Record<Outcome, number> = { expired: 0, settled: 0, deferred: 0 };

    // One at a time: a batch is small, and parallel writes against the same
    // product row would only contend with each other.
    for (const transaction of overdue) {
      summary[await this.resolve(transaction)] += 1;
    }

    return summary;
  }

  private async resolve(transaction: Transaction): Promise<Outcome> {
    if (!transaction.paymentSubmitted) {
      return this.expire(transaction, false);
    }

    const lookup =
      transaction.gatewayTransactionId === undefined
        ? this.gateway.findByReference(transaction.reference)
        : this.gateway.find(transaction.gatewayTransactionId);

    return await lookup.match({
      ok: (payment) => {
        if (payment === undefined) {
          return this.claimAbandoned(transaction)
            ? this.expire(transaction, true)
            : Promise.resolve<Outcome>('deferred');
        }

        if (payment.status === 'PENDING') {
          return Promise.resolve<Outcome>('deferred');
        }

        return this.settle
          .applyTo(transaction, { reference: transaction.reference, ...payment })
          .match({
            ok: (settled): Outcome => (settled.isFinal ? 'settled' : 'deferred'),
            err: (): Outcome => 'deferred',
          });
      },
      err: () => Promise.resolve<Outcome>('deferred'),
    });
  }

  private expire(transaction: Transaction, paymentAbandoned: boolean): Promise<Outcome> {
    const expired = transaction.expire(this.clock.now(), { paymentAbandoned });

    if (expired === undefined) {
      return Promise.resolve('deferred');
    }

    return this.transactions.saveSettlement(expired, undefined).match({
      ok: (): Outcome => 'expired',
      // Lost a race with a payment or another run: the row is no longer this
      // run's to close.
      err: (): Outcome => 'deferred',
    });
  }

  private claimAbandoned(transaction: Transaction): boolean {
    const claimedAt = transaction.paymentClaimedAt?.getTime() ?? 0;
    return this.clock.now().getTime() - claimedAt >= ExpireReservations.ABANDONED_CLAIM_MS;
  }
}
