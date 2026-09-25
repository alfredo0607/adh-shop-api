import { Logger } from '@nestjs/common';

import { ResultAsync } from '../../../../shared/domain';
import type { ExpireReservations } from '../../application/expire-reservations.usecase';
import { CheckoutUnavailable } from '../../domain/checkout.errors';
import { ReservationSweeper } from './reservation-sweeper';

describe('ReservationSweeper', () => {
  const useCase = (
    result: ReturnType<ExpireReservations['execute']>,
  ): { expire: ExpireReservations; execute: jest.Mock } => {
    const execute = jest.fn(() => result);
    return { expire: { execute } as unknown as ExpireReservations, execute };
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs the expiry on every tick', async () => {
    jest.useFakeTimers();
    const { expire, execute } = useCase(
      ResultAsync.ok({ expired: 1, settled: 0, deferred: 0, stale: 0 }),
    );
    const sweeper = new ReservationSweeper(expire, 1_000);

    sweeper.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3_000);
    sweeper.onApplicationShutdown();

    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('does nothing when disabled', async () => {
    jest.useFakeTimers();
    const { expire, execute } = useCase(
      ResultAsync.ok({ expired: 0, settled: 0, deferred: 0, stale: 0 }),
    );

    new ReservationSweeper(expire, 0).onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5_000);

    expect(execute).not.toHaveBeenCalled();
  });

  it('never stacks a run on top of one still going', async () => {
    let finish: () => void = () => undefined;
    const slow = ResultAsync.fromSafePromise(
      new Promise<{ expired: number; settled: number; deferred: number; stale: number }>(
        (resolve) => {
          finish = (): void => resolve({ expired: 0, settled: 0, deferred: 0, stale: 0 });
        },
      ),
    );
    const { expire, execute } = useCase(slow);
    const sweeper = new ReservationSweeper(expire, 1_000);

    const first = sweeper.sweep();
    await sweeper.sweep();
    finish();
    await first;

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reports stale payments at error level, since they need a person', async () => {
    const { expire } = useCase(ResultAsync.ok({ expired: 0, settled: 0, deferred: 2, stale: 2 }));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await new ReservationSweeper(expire, 1_000).sweep();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('2 payment(s) still PENDING'));
    error.mockRestore();
  });

  it('survives a failed run, and runs again next time', async () => {
    const { expire, execute } = useCase(ResultAsync.err(new CheckoutUnavailable('down')));
    const sweeper = new ReservationSweeper(expire, 1_000);

    await sweeper.sweep();
    await sweeper.sweep();

    expect(execute).toHaveBeenCalledTimes(2);
  });
});
