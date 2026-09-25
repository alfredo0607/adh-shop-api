import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { ExpireReservations } from '../../application/expire-reservations.usecase';

export const SWEEP_INTERVAL_MS = Symbol('SweepIntervalMs');

/**
 * Runs the reservation expiry on a timer inside the API process.
 *
 * A timer rather than a separate scheduled job: there is one host, and the
 * expiry is safe to run from several processes at once — every write it makes
 * is conditional, so a blue/green deployment briefly running two copies costs
 * nothing but a lost race. A dedicated scheduler becomes worth it with many
 * instances, where each would otherwise read the same rows every minute.
 */
@Injectable()
export class ReservationSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReservationSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly expireReservations: ExpireReservations,
    @Inject(SWEEP_INTERVAL_MS) private readonly intervalMs: number,
  ) {}

  onApplicationBootstrap(): void {
    if (this.intervalMs <= 0) {
      this.logger.log('Reservation expiry is disabled');
      return;
    }

    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    // Never the reason the process stays alive during shutdown.
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Skips a tick while the previous run is still going, rather than stacking runs. */
  async sweep(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.expireReservations.execute().match({
        ok: (summary) => {
          if (summary.expired + summary.settled + summary.deferred > 0) {
            this.logger.log(
              `Reservations: ${summary.expired} expired, ${summary.settled} settled, ` +
                `${summary.deferred} deferred`,
            );
          }
        },
        err: (error) => this.logger.warn(`Reservation expiry skipped: ${error.message}`),
      });
    } finally {
      this.running = false;
    }
  }
}
