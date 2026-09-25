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
  /**
   * Of the deferred, payments the gateway has kept PENDING for longer than
   * STALE_PAYMENT_MS past their deadline. Their units stay reserved on purpose
   * — the gateway could still approve them — so they need a person, and the
   * sweeper reports them at error level.
   */
  readonly stale: number;
}

type Outcome = 'expired' | 'settled' | 'deferred' | 'stale';

/**
 * Returns the units of abandoned checkouts to the shelf.
 *
 * Runs on a schedule. Each overdue reservation is handled on its own, so one
 * that cannot be resolved now — the gateway is slow, a write lost a race —
 * is simply retried on the next run instead of blocking the rest.
 */
export class ExpireReservations {
  /** Overdue reservations read per page. */
  static readonly BATCH_SIZE = 25;

  /**
   * Pages per run. Paging past the rows a run defers is what keeps a pile of
   * payments stuck at the gateway — always the oldest, so always first — from
   * hiding every newer abandoned checkout behind them. Bounded so one run
   * cannot grow without limit; the next run starts from the top again.
   */
  static readonly MAX_PAGES = 4;

  /** Past this, a payment the gateway still calls PENDING is reported as stale. */
  static readonly STALE_PAYMENT_MS = 24 * 60 * 60_000;

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

  /**
   * Fails only if the first page cannot be read. A later page failing ends the
   * run early with what it already did; the next run picks up the rest.
   */
  execute(): ResultAsync<ExpirySummary, CheckoutUnavailable> {
    const now = this.clock.now();

    return this.transactions
      .findExpiredReservations(now, ExpireReservations.BATCH_SIZE)
      .andThen((firstPage) => ResultAsync.fromSafePromise(this.resolveFrom(firstPage, now)));
  }

  private async resolveFrom(firstPage: Transaction[], now: Date): Promise<ExpirySummary> {
    const counts: Record<Outcome, number> = { expired: 0, settled: 0, deferred: 0, stale: 0 };
    let page = firstPage;

    for (let pages = 1; ; pages += 1) {
      // One at a time: a page is small, and parallel writes against the same
      // product row would only contend with each other.
      for (const transaction of page) {
        counts[await this.resolve(transaction)] += 1;
      }

      const last = page[page.length - 1];
      if (last === undefined || page.length < ExpireReservations.BATCH_SIZE) break;
      if (pages >= ExpireReservations.MAX_PAGES) break;

      const next = await this.transactions.findExpiredReservations(
        now,
        ExpireReservations.BATCH_SIZE,
        last,
      );
      if (next.isErr()) break;
      page = next.value;
    }

    return {
      expired: counts.expired,
      settled: counts.settled,
      deferred: counts.deferred + counts.stale,
      stale: counts.stale,
    };
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
          return Promise.resolve<Outcome>(this.isStale(transaction) ? 'stale' : 'deferred');
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

  private isStale(transaction: Transaction): boolean {
    const overdueMs = this.clock.now().getTime() - transaction.reservationExpiresAt.getTime();
    return overdueMs >= ExpireReservations.STALE_PAYMENT_MS;
  }

  private claimAbandoned(transaction: Transaction): boolean {
    const claimedAt = transaction.paymentClaimedAt?.getTime() ?? 0;
    return this.clock.now().getTime() - claimedAt >= ExpireReservations.ABANDONED_CLAIM_MS;
  }
}
