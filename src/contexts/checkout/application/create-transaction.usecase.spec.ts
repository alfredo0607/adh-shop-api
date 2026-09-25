import { type ClockPort, type IdGeneratorPort, ResultAsync, err } from '../../../shared/domain';
import { aProduct } from '../../catalog/__fixtures__/product.fixture';
import { InMemoryProductRepository } from '../../catalog/infrastructure/persistence/in-memory-product.repository';
import { FEES, NOW, TOTAL_FOR_ONE, TTL_MS, aCommand } from '../__fixtures__/checkout.fixture';
import { CheckoutUnavailable } from '../domain/checkout.errors';
import { CatalogInventoryAdapter } from '../infrastructure/inventory/catalog-inventory.adapter';
import {
  InMemoryCustomerRepository,
  InMemoryTransactionRepository,
} from '../infrastructure/persistence/in-memory-checkout.repositories';
import { CreateTransaction } from './create-transaction.usecase';

describe('CreateTransaction', () => {
  interface Setup {
    useCase: CreateTransaction;
    customers: InMemoryCustomerRepository;
    transactions: InMemoryTransactionRepository;
    stockOf: () => Promise<{ available: number; reserved: number }>;
  }

  const clock: ClockPort = { now: () => NOW };

  const setup = (available = 5): Setup => {
    const products = new InMemoryProductRepository([aProduct({ id: 'prod-01', available })]);
    const customers = new InMemoryCustomerRepository();
    const transactions = new InMemoryTransactionRepository();
    let sequence = 0;

    const useCase = new CreateTransaction(
      new CatalogInventoryAdapter(products),
      customers,
      transactions,
      { generate: (): string => `id-${++sequence}` } satisfies IdGeneratorPort,
      clock,
      { fees: FEES, reservationTtlMs: TTL_MS },
    );

    const stockOf = async (): Promise<{ available: number; reserved: number }> => {
      const product = await products.findById('prod-01');
      if (product.isErr()) throw new Error('fixture product vanished');
      return { available: product.value.stock.available, reserved: product.value.stock.reserved };
    };

    return { useCase, customers, transactions, stockOf };
  };

  it('opens a PENDING transaction with a server-computed total', async () => {
    const { useCase, transactions } = setup();

    const result = await useCase.execute(aCommand());

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.status).toBe('PENDING');
    expect(result.value.quote.totalInCents).toBe(TOTAL_FOR_ONE);
    expect(result.value.product).toEqual({ id: 'prod-01', name: expect.any(String) });
    expect(transactions.byId.get(result.value.id)).toBe(result.value);
  });

  it('reserves the units, so nobody else can buy them while the buyer pays', async () => {
    const { useCase, stockOf } = setup(5);

    await useCase.execute(aCommand({ units: 2, expectedTotalInCents: 2 * 150_000 + 1_700_00 }));

    expect(await stockOf()).toEqual({ available: 3, reserved: 2 });
  });

  it('records the buyer normalised, and reuses the customer when the email returns', async () => {
    const { useCase, customers } = setup();

    const first = await useCase.execute(aCommand());
    const second = await useCase.execute(
      aCommand({
        customer: { fullName: 'Laura G.', email: 'laura@example.com', phone: '3001234567' },
      }),
    );

    expect(customers.byEmail.size).toBe(1);
    if (first.isErr() || second.isErr()) throw new Error('expected both to succeed');
    expect(second.value.customer.id).toBe(first.value.customer.id);
    expect(second.value.customer.fullName).toBe('Laura G.');
  });

  it('refuses a total that differs from the one the buyer was shown, and gives the units back', async () => {
    const { useCase, stockOf } = setup(5);

    const result = await useCase.execute(aCommand({ expectedTotalInCents: 1 }));

    expect(result.isErr() && result.error.code).toBe('AMOUNT_MISMATCH');
    expect(await stockOf()).toEqual({ available: 5, reserved: 0 });
  });

  it('releases the reservation when the transaction cannot be written', async () => {
    const { useCase, transactions, stockOf } = setup(5);
    jest
      .spyOn(transactions, 'create')
      .mockReturnValue(ResultAsync.err(new CheckoutUnavailable('store down')));

    const result = await useCase.execute(aCommand());

    expect(result.isErr() && result.error.code).toBe('CHECKOUT_UNAVAILABLE');
    expect(await stockOf()).toEqual({ available: 5, reserved: 0 });
  });

  it('still reports the original failure when the release fails too', async () => {
    const products = new InMemoryProductRepository([aProduct({ id: 'prod-01', available: 5 })]);
    const inventory = new CatalogInventoryAdapter(products);
    jest
      .spyOn(inventory, 'release')
      .mockReturnValue(ResultAsync.fromResult(err(new CheckoutUnavailable('release failed'))));

    const useCase = new CreateTransaction(
      inventory,
      new InMemoryCustomerRepository(),
      new InMemoryTransactionRepository(),
      { generate: (): string => 'id' },
      clock,
      { fees: FEES, reservationTtlMs: TTL_MS },
    );

    const result = await useCase.execute(aCommand({ expectedTotalInCents: 1 }));

    expect(result.isErr() && result.error.code).toBe('AMOUNT_MISMATCH');
  });

  it('answers out of stock without reserving anything', async () => {
    const { useCase, stockOf } = setup(1);

    const result = await useCase.execute(aCommand({ units: 2 }));

    expect(result.isErr() && result.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf()).toEqual({ available: 1, reserved: 0 });
  });

  it('answers not found for a product that does not exist', async () => {
    const { useCase } = setup();

    const result = await useCase.execute(aCommand({ productId: 'nope' }));

    expect(result.isErr() && result.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it.each([
    ['INVALID_CUSTOMER', { customer: { fullName: 'Laura', email: 'bad', phone: '3001234567' } }],
    [
      'INVALID_DELIVERY_ADDRESS',
      {
        deliveryAddress: {
          addressLine1: 'Calle 93 # 11-26',
          city: 'Miami',
          region: 'Florida',
          country: 'US',
        },
      },
    ],
    ['INVALID_TRANSACTION', { units: 0 }],
  ])('rejects %s before reserving anything', async (code, override) => {
    const { useCase, stockOf } = setup(5);

    const result = await useCase.execute(aCommand(override));

    expect(result.isErr() && result.error.code).toBe(code);
    expect(await stockOf()).toEqual({ available: 5, reserved: 0 });
  });
});
