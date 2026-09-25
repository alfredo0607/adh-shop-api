import { ResultAsync } from '../../../shared/domain';
import { aProduct } from '../../catalog/__fixtures__/product.fixture';
import { InMemoryProductRepository } from '../../catalog/infrastructure/persistence/in-memory-product.repository';
import { NOW, TOTAL_FOR_ONE, TTL_MS, aTransaction } from '../__fixtures__/checkout.fixture';
import { CheckoutUnavailable, PaymentGatewayUnavailable } from '../domain/checkout.errors';
import { Transaction } from '../domain/transaction';
import { FakePaymentGateway } from '../infrastructure/payment/fake-payment.gateway';
import { InMemoryTransactionRepository } from '../infrastructure/persistence/in-memory-checkout.repositories';
import { ExpireReservations } from './expire-reservations.usecase';
import { SettleTransaction } from './settle-transaction.usecase';

describe('ExpireReservations', () => {
  const ID = '6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60';
  const PAST_DEADLINE = new Date(NOW.getTime() + TTL_MS + 60_000);

  interface Setup {
    useCase: ExpireReservations;
    gateway: FakePaymentGateway;
    transactions: InMemoryTransactionRepository;
    statusOf: () => Promise<string>;
    stock: () => Promise<{ available: number; reserved: number }>;
  }

  /** One reserved unit of prod-01, in the state `prepare` leaves it. */
  const setup = async (
    prepare: (open: Transaction) => Transaction = (open) => open,
    now: Date = PAST_DEADLINE,
  ): Promise<Setup> => {
    const products = new InMemoryProductRepository([
      aProduct({ id: 'prod-01', available: 4, reserved: 1 }),
    ]);
    const transactions = new InMemoryTransactionRepository(products);
    await transactions.create(prepare(aTransaction({ id: ID })));
    const gateway = new FakePaymentGateway();
    const clock = { now: (): Date => now };

    return {
      useCase: new ExpireReservations(
        transactions,
        gateway,
        new SettleTransaction(transactions, clock),
        clock,
      ),
      gateway,
      transactions,
      statusOf: async (): Promise<string> => {
        const stored = await transactions.findById(ID);
        if (stored.isErr()) throw new Error('missing');
        return stored.value.status;
      },
      stock: async (): Promise<{ available: number; reserved: number }> => {
        const product = await products.findById('prod-01');
        if (product.isErr()) throw new Error('missing');
        return { available: product.value.stock.available, reserved: product.value.stock.reserved };
      },
    };
  };

  const claimedAt =
    (at: Date, gatewayId?: string) =>
    (open: Transaction): Transaction => {
      const claimed = open.claimPayment(at);
      if (claimed.isErr()) throw new Error('claim should succeed');
      return gatewayId === undefined
        ? claimed.value
        : claimed.value.recordGatewayPayment(gatewayId, at);
    };

  it('expires an abandoned checkout and puts its unit back on the shelf', async () => {
    const { useCase, statusOf, stock } = await setup();

    const summary = await useCase.execute();

    expect(summary.isOk() && summary.value).toEqual({
      expired: 1,
      settled: 0,
      deferred: 0,
      stale: 0,
    });
    expect(await statusOf()).toBe('EXPIRED');
    expect(await stock()).toEqual({ available: 5, reserved: 0 });
  });

  it('leaves a reservation alone until its deadline passes', async () => {
    const { useCase, statusOf } = await setup(undefined, new Date(NOW.getTime() + 60_000));

    const summary = await useCase.execute();

    expect(summary.isOk() && summary.value).toEqual({
      expired: 0,
      settled: 0,
      deferred: 0,
      stale: 0,
    });
    expect(await statusOf()).toBe('PENDING');
  });

  it('settles with the real outcome when a payment was made after all', async () => {
    const { useCase, gateway, statusOf, stock } = await setup(
      claimedAt(new Date(NOW.getTime() + 60_000), 'gw-1'),
    );
    gateway.nextFind = ResultAsync.ok({
      gatewayTransactionId: 'gw-1',
      status: 'APPROVED',
      amountInCents: TOTAL_FOR_ONE,
    });

    const summary = await useCase.execute();

    expect(summary.isOk() && summary.value.settled).toBe(1);
    expect(await statusOf()).toBe('APPROVED');
    expect(await stock()).toEqual({ available: 4, reserved: 0 });
  });

  it('never expires a payment that is still in flight', async () => {
    const { useCase, statusOf, stock } = await setup(
      claimedAt(new Date(NOW.getTime() + 60_000), 'gw-1'),
    );

    const summary = await useCase.execute();

    expect(summary.isOk() && summary.value.deferred).toBe(1);
    expect(await statusOf()).toBe('PENDING');
    expect(await stock()).toEqual({ available: 4, reserved: 1 });
  });

  it('finds a payment by reference when the charge timed out before returning its id', async () => {
    const { useCase, gateway, statusOf } = await setup(claimedAt(new Date(NOW.getTime() + 60_000)));
    gateway.nextFindByReference = ResultAsync.ok({
      gatewayTransactionId: 'gw-9',
      status: 'DECLINED',
      amountInCents: TOTAL_FOR_ONE,
    });

    await useCase.execute();

    expect(await statusOf()).toBe('DECLINED');
  });

  it('expires a claim the gateway never heard of, once the grace period is over', async () => {
    const claimTime = new Date(PAST_DEADLINE.getTime() - ExpireReservations.ABANDONED_CLAIM_MS);
    const { useCase, statusOf, stock } = await setup(claimedAt(claimTime));

    await useCase.execute();

    expect(await statusOf()).toBe('EXPIRED');
    expect(await stock()).toEqual({ available: 5, reserved: 0 });
  });

  it('waits out the grace period before giving up on an unknown claim', async () => {
    const { useCase, statusOf } = await setup(
      // Inside the reservation, two minutes before this run: well within the grace.
      claimedAt(new Date(NOW.getTime() + TTL_MS - 60_000)),
    );

    await useCase.execute();

    expect(await statusOf()).toBe('PENDING');
  });

  it('reports a payment the gateway has kept PENDING for a day as stale, and keeps its units', async () => {
    const aDayLate = new Date(NOW.getTime() + TTL_MS + ExpireReservations.STALE_PAYMENT_MS);
    const { useCase, stock } = await setup(
      claimedAt(new Date(NOW.getTime() + 60_000), 'gw-1'),
      aDayLate,
    );

    const summary = await useCase.execute();

    expect(summary.isOk() && summary.value).toEqual({
      expired: 0,
      settled: 0,
      deferred: 1,
      stale: 1,
    });
    expect(await stock()).toEqual({ available: 4, reserved: 1 });
  });

  it('defers when the gateway cannot be asked', async () => {
    const { useCase, gateway, statusOf } = await setup(
      claimedAt(new Date(NOW.getTime() + 60_000), 'gw-1'),
    );
    gateway.nextFind = ResultAsync.err(new PaymentGatewayUnavailable('down'));

    const summary = await useCase.execute();

    expect(summary.isOk() && summary.value.deferred).toBe(1);
    expect(await statusOf()).toBe('PENDING');
  });

  it('defers when it loses a race for the row', async () => {
    const { useCase, transactions } = await setup();
    jest
      .spyOn(transactions, 'saveSettlement')
      .mockReturnValue(ResultAsync.err(new CheckoutUnavailable('conflict')));

    const summary = await useCase.execute();

    expect(summary.isOk() && summary.value).toEqual({
      expired: 0,
      settled: 0,
      deferred: 1,
      stale: 0,
    });
  });

  it('reports a failure to read the overdue reservations', async () => {
    const { useCase, transactions } = await setup();
    jest
      .spyOn(transactions, 'findExpiredReservations')
      .mockReturnValue(ResultAsync.err(new CheckoutUnavailable('down')));

    const summary = await useCase.execute();

    expect(summary.isErr()).toBe(true);
  });

  it('pages past payments stuck at the gateway, so newer abandoned checkouts still expire', async () => {
    const products = new InMemoryProductRepository([
      aProduct({ id: 'prod-01', available: 0, reserved: ExpireReservations.BATCH_SIZE + 1 }),
    ]);
    const transactions = new InMemoryTransactionRepository(products);
    const claimTime = new Date(NOW.getTime() + 60_000);

    // A full page of the oldest reservations, each with a payment in flight.
    for (let i = 0; i < ExpireReservations.BATCH_SIZE; i += 1) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      await transactions.create(claimedAt(claimTime, `gw-${i}`)(aTransaction({ id })));
    }
    // And one newer checkout, simply abandoned, behind them.
    const newer = aTransaction({ id: 'ffffffff-0000-4000-8000-000000000000' });
    await transactions.create(
      Transaction.restore({
        id: newer.id,
        status: 'PENDING',
        product: newer.product,
        quote: newer.quote,
        customer: newer.customer,
        deliveryAddress: newer.deliveryAddress,
        createdAt: newer.createdAt,
        updatedAt: newer.updatedAt,
        reservationExpiresAt: new Date(newer.reservationExpiresAt.getTime() + 1_000),
        version: 0,
      }),
    );
    const clock = { now: (): Date => PAST_DEADLINE };
    const useCase = new ExpireReservations(
      transactions,
      new FakePaymentGateway(),
      new SettleTransaction(transactions, clock),
      clock,
    );

    const summary = await useCase.execute();

    expect(summary.isOk() && summary.value.expired).toBe(1);
    expect(summary.isOk() && summary.value.deferred).toBe(ExpireReservations.BATCH_SIZE);
  });

  it('stops paging after a page fails, keeping what it already did', async () => {
    const { useCase, transactions } = await setup();
    const find = jest.spyOn(transactions, 'findExpiredReservations');
    find.mockImplementationOnce(() =>
      ResultAsync.ok(Array.from({ length: ExpireReservations.BATCH_SIZE }, () => aTransaction())),
    );
    find.mockImplementationOnce(() => ResultAsync.err(new CheckoutUnavailable('down')));

    const summary = await useCase.execute();

    expect(summary.isOk()).toBe(true);
    expect(find).toHaveBeenCalledTimes(2);
  });
});
