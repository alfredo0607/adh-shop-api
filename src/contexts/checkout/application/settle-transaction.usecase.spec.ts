import { ResultAsync } from '../../../shared/domain';
import { aProduct } from '../../catalog/__fixtures__/product.fixture';
import { InMemoryProductRepository } from '../../catalog/infrastructure/persistence/in-memory-product.repository';
import { NOW, TOTAL_FOR_ONE, aTransaction } from '../__fixtures__/checkout.fixture';
import { CheckoutUnavailable, PaymentGatewayUnavailable } from '../domain/checkout.errors';
import type { GatewayStatus } from '../domain/transaction';
import { FakePaymentGateway } from '../infrastructure/payment/fake-payment.gateway';
import { InMemoryTransactionRepository } from '../infrastructure/persistence/in-memory-checkout.repositories';
import { FindTransaction } from './find-transaction.usecase';
import { type PaymentOutcome, SettleTransaction } from './settle-transaction.usecase';

describe('SettleTransaction', () => {
  const ID = '6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60';
  const clock = { now: (): Date => new Date(NOW.getTime() + 60_000) };

  /** A transaction holding one reserved unit of prod-01, with a payment in flight. */
  const setup = async (): Promise<{
    useCase: SettleTransaction;
    transactions: InMemoryTransactionRepository;
    stock: () => Promise<{ available: number; reserved: number }>;
  }> => {
    const products = new InMemoryProductRepository([
      aProduct({ id: 'prod-01', available: 4, reserved: 1 }),
    ]);
    const transactions = new InMemoryTransactionRepository(products);
    const claimed = aTransaction({ id: ID }).claimPayment(clock.now());
    if (claimed.isErr()) throw new Error('fixture claim failed');
    await transactions.create(claimed.value.recordGatewayPayment('gw-1', clock.now()));

    return {
      useCase: new SettleTransaction(transactions, clock),
      transactions,
      stock: async (): Promise<{ available: number; reserved: number }> => {
        const product = await products.findById('prod-01');
        if (product.isErr()) throw new Error('product vanished');
        return { available: product.value.stock.available, reserved: product.value.stock.reserved };
      },
    };
  };

  const outcome = (status: GatewayStatus, amountInCents = TOTAL_FOR_ONE): PaymentOutcome => ({
    reference: ID,
    gatewayTransactionId: 'gw-1',
    status,
    amountInCents,
  });

  it('approves: the unit is sold and a delivery is assigned', async () => {
    const { useCase, transactions, stock } = await setup();

    const result = await useCase.execute(outcome('APPROVED'));

    expect(result.isOk() && result.value.status).toBe('APPROVED');
    expect(await stock()).toEqual({ available: 4, reserved: 0 });
    expect(transactions.deliveries.get(ID)?.status).toBe('PREPARING');
  });

  it.each(['DECLINED', 'VOIDED', 'ERROR'] as const)(
    '%s: the unit goes back on the shelf and nothing is delivered',
    async (status) => {
      const { useCase, transactions, stock } = await setup();

      const result = await useCase.execute(outcome(status));

      expect(result.isOk() && result.value.status).toBe(status);
      expect(await stock()).toEqual({ available: 5, reserved: 0 });
      expect(transactions.deliveries.has(ID)).toBe(false);
    },
  );

  it('applies a repeated outcome only once', async () => {
    const { useCase, stock } = await setup();

    await useCase.execute(outcome('APPROVED'));
    const again = await useCase.execute(outcome('APPROVED'));

    expect(again.isOk() && again.value.status).toBe('APPROVED');
    expect(await stock()).toEqual({ available: 4, reserved: 0 });
  });

  it('never lets a later outcome overwrite a final one', async () => {
    const { useCase } = await setup();

    await useCase.execute(outcome('APPROVED'));
    const late = await useCase.execute(outcome('DECLINED'));

    expect(late.isOk() && late.value.status).toBe('APPROVED');
  });

  it('changes nothing while the gateway still says PENDING', async () => {
    const { useCase, stock } = await setup();

    const result = await useCase.execute(outcome('PENDING'));

    expect(result.isOk() && result.value.status).toBe('PENDING');
    expect(await stock()).toEqual({ available: 4, reserved: 1 });
  });

  it('refuses to approve an amount other than the one charged', async () => {
    const { useCase, stock } = await setup();

    const result = await useCase.execute(outcome('APPROVED', 1));

    expect(result.isErr() && result.error.code).toBe('SETTLEMENT_AMOUNT_MISMATCH');
    expect(await stock()).toEqual({ available: 4, reserved: 1 });
  });

  it('returns what the winner stored when it loses a race', async () => {
    const { useCase, transactions } = await setup();
    const stored = await transactions.findById(ID);
    if (stored.isErr()) throw new Error('missing');

    // Another writer settles between this one's read and its write.
    const racing = useCase.applyTo(stored.value, outcome('APPROVED'));
    await useCase.execute(outcome('APPROVED'));
    const result = await racing;

    expect(result.isOk() && result.value.status).toBe('APPROVED');
  });

  it('reports a store failure instead of hiding it', async () => {
    const { useCase, transactions } = await setup();
    jest
      .spyOn(transactions, 'saveSettlement')
      .mockReturnValue(ResultAsync.err(new CheckoutUnavailable('down')));

    const result = await useCase.execute(outcome('APPROVED'));

    expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
  });

  it('answers not found for a reference it never issued', async () => {
    const { useCase } = await setup();

    const result = await useCase.execute({ ...outcome('APPROVED'), reference: 'unknown' });

    expect(result.isErr() && result.error.code).toBe('TRANSACTION_NOT_FOUND');
  });
});

describe('FindTransaction, while a payment is in flight', () => {
  const ID = '6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60';
  const clock = { now: (): Date => new Date(NOW.getTime() + 60_000) };

  const setup = async (
    withPayment = true,
  ): Promise<{ useCase: FindTransaction; gateway: FakePaymentGateway }> => {
    const transactions = new InMemoryTransactionRepository();
    const claimed = aTransaction({ id: ID }).claimPayment(clock.now());
    if (claimed.isErr()) throw new Error('fixture claim failed');
    await transactions.create(
      withPayment
        ? claimed.value.recordGatewayPayment('gw-1', clock.now())
        : aTransaction({ id: ID }),
    );
    const gateway = new FakePaymentGateway();

    return {
      useCase: new FindTransaction(
        transactions,
        gateway,
        new SettleTransaction(transactions, clock),
      ),
      gateway,
    };
  };

  it('asks the gateway and settles, so polling alone is enough', async () => {
    const { useCase, gateway } = await setup();
    gateway.nextFind = ResultAsync.ok({
      gatewayTransactionId: 'gw-1',
      status: 'APPROVED',
      amountInCents: TOTAL_FOR_ONE,
    });

    const result = await useCase.execute(ID);

    expect(result.isOk() && result.value.status).toBe('APPROVED');
  });

  it('still answers with what is stored when the gateway is down', async () => {
    const { useCase, gateway } = await setup();
    gateway.nextFind = ResultAsync.err(new PaymentGatewayUnavailable('down'));

    const result = await useCase.execute(ID);

    expect(result.isOk() && result.value.status).toBe('PENDING');
  });

  it('finds the payment by reference when its gateway id was never recorded', async () => {
    const transactions = new InMemoryTransactionRepository();
    const claimed = aTransaction({ id: ID }).claimPayment(clock.now());
    if (claimed.isErr()) throw new Error('fixture claim failed');
    await transactions.create(claimed.value);
    const gateway = new FakePaymentGateway();
    gateway.nextFindByReference = ResultAsync.ok({
      gatewayTransactionId: 'gw-7',
      status: 'APPROVED',
      amountInCents: TOTAL_FOR_ONE,
    });

    const result = await new FindTransaction(
      transactions,
      gateway,
      new SettleTransaction(transactions, clock),
    ).execute(ID);

    expect(result.isOk() && result.value.status).toBe('APPROVED');
    expect(result.isOk() && result.value.gatewayTransactionId).toBe('gw-7');
  });

  it('does not bother the gateway before a payment was sent', async () => {
    const { useCase, gateway } = await setup(false);
    const find = jest.spyOn(gateway, 'find');

    await useCase.execute(ID);

    expect(find).not.toHaveBeenCalled();
  });
});
