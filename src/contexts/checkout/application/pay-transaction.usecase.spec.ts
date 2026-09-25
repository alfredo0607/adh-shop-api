import { ResultAsync } from '../../../shared/domain';
import { NOW, TTL_MS, aTransaction } from '../__fixtures__/checkout.fixture';
import {
  CheckoutUnavailable,
  PaymentGatewayUnavailable,
  PaymentRejected,
} from '../domain/checkout.errors';
import { FakePaymentGateway } from '../infrastructure/payment/fake-payment.gateway';
import { InMemoryTransactionRepository } from '../infrastructure/persistence/in-memory-checkout.repositories';
import { type PayTransactionCommand, PayTransaction } from './pay-transaction.usecase';

describe('PayTransaction', () => {
  const setup = async (
    at: Date = new Date(NOW.getTime() + 60_000),
  ): Promise<{
    useCase: PayTransaction;
    gateway: FakePaymentGateway;
    transactions: InMemoryTransactionRepository;
    command: PayTransactionCommand;
  }> => {
    const transactions = new InMemoryTransactionRepository();
    const transaction = aTransaction();
    await transactions.create(transaction);
    const gateway = new FakePaymentGateway();

    return {
      useCase: new PayTransaction(transactions, gateway, { now: () => at }),
      gateway,
      transactions,
      command: {
        transactionId: transaction.id,
        cardToken: 'tok_test_123',
        installments: 1,
        acceptanceToken: 'acceptance',
        personalDataAuthorizationToken: 'personal-data',
      },
    };
  };

  const stored = async (
    transactions: InMemoryTransactionRepository,
    id: string,
  ): Promise<ReturnType<typeof aTransaction>> => {
    const result = await transactions.findById(id);
    if (result.isErr()) throw new Error('transaction vanished');
    return result.value;
  };

  it('charges the stored total to the stored email, never amounts from the request', async () => {
    const { useCase, gateway, command } = await setup();

    await useCase.execute(command);

    expect(gateway.charges).toEqual([
      expect.objectContaining({
        reference: command.transactionId,
        amountInCents: 150_000 + 500_00 + 1_200_00,
        currency: 'COP',
        customerEmail: 'laura@example.com',
        cardToken: 'tok_test_123',
      }),
    ]);
  });

  it('records the gateway id and leaves the transaction PENDING until it settles', async () => {
    const { useCase, transactions, command } = await setup();

    const result = await useCase.execute(command);

    expect(result.isOk() && result.value.status).toBe('PENDING');
    const saved = await stored(transactions, command.transactionId);
    expect(saved.gatewayTransactionId).toBe('gw-1');
    expect(saved.paymentSubmitted).toBe(true);
  });

  it('refuses a second payment for the same transaction without calling the gateway', async () => {
    const { useCase, gateway, command } = await setup();

    await useCase.execute(command);
    const second = await useCase.execute({ ...command, cardToken: 'tok_other' });

    expect(second.isErr() && second.error.code).toBe('TRANSACTION_NOT_PAYABLE');
    expect(gateway.charges).toHaveLength(1);
  });

  it('refuses to charge once the reservation has expired', async () => {
    const { useCase, gateway, command } = await setup(new Date(NOW.getTime() + TTL_MS + 1));

    const result = await useCase.execute(command);

    expect(result.isErr() && result.error.code).toBe('RESERVATION_EXPIRED');
    expect(gateway.charges).toHaveLength(0);
  });

  it('loses a race for the claim cleanly, without charging', async () => {
    const { useCase, gateway, transactions, command } = await setup();
    jest
      .spyOn(transactions, 'claimPayment')
      .mockReturnValue(ResultAsync.err(new CheckoutUnavailable('conditional check failed')));

    const result = await useCase.execute(command);

    expect(result.isErr()).toBe(true);
    expect(gateway.charges).toHaveLength(0);
  });

  it('releases the claim when the gateway rejects the request, so the buyer can retry', async () => {
    const { useCase, gateway, transactions, command } = await setup();
    gateway.nextCharge = ResultAsync.err(
      new PaymentRejected('refused', { reason: 'INPUT_VALIDATION_ERROR' }),
    );

    const result = await useCase.execute(command);

    expect(result.isErr() && result.error.code).toBe('PAYMENT_REJECTED');
    expect((await stored(transactions, command.transactionId)).paymentSubmitted).toBe(false);
  });

  it('keeps the claim when the gateway is unreachable, since the charge may have happened', async () => {
    const { useCase, gateway, transactions, command } = await setup();
    gateway.nextCharge = ResultAsync.err(new PaymentGatewayUnavailable('timeout'));

    const result = await useCase.execute(command);

    expect(result.isErr() && result.error.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
    expect((await stored(transactions, command.transactionId)).paymentSubmitted).toBe(true);
  });

  it('returns the stored transaction when its outcome was settled before the id was recorded', async () => {
    const { useCase, transactions, command } = await setup();
    jest
      .spyOn(transactions, 'update')
      .mockReturnValueOnce(ResultAsync.err(new CheckoutUnavailable('version changed')));

    const result = await useCase.execute(command);

    expect(result.isOk() && result.value.id).toBe(command.transactionId);
  });

  it('answers not found for an unknown transaction', async () => {
    const { useCase, command } = await setup();

    const result = await useCase.execute({ ...command, transactionId: 'nope' });

    expect(result.isErr() && result.error.code).toBe('TRANSACTION_NOT_FOUND');
  });
});
