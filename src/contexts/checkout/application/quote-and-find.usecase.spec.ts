import { aProduct } from '../../catalog/__fixtures__/product.fixture';
import { InMemoryProductRepository } from '../../catalog/infrastructure/persistence/in-memory-product.repository';
import { FEES, TOTAL_FOR_ONE, aTransaction } from '../__fixtures__/checkout.fixture';
import { CatalogInventoryAdapter } from '../infrastructure/inventory/catalog-inventory.adapter';
import { InMemoryTransactionRepository } from '../infrastructure/persistence/in-memory-checkout.repositories';
import { FindTransaction } from './find-transaction.usecase';
import { SettleTransaction } from './settle-transaction.usecase';
import { FakePaymentGateway } from '../infrastructure/payment/fake-payment.gateway';
import { NOW } from '../__fixtures__/checkout.fixture';
import { QuoteCheckout } from './quote-checkout.usecase';

describe('QuoteCheckout', () => {
  const products = new InMemoryProductRepository([aProduct({ id: 'prod-01', available: 2 })]);
  const useCase = new QuoteCheckout(new CatalogInventoryAdapter(products), FEES);

  it('prices the order the same way the transaction will', async () => {
    const result = await useCase.execute({ productId: 'prod-01', units: 1 });

    expect(result.isOk() && result.value.totalInCents).toBe(TOTAL_FOR_ONE);
  });

  it('reserves nothing, since the buyer is only looking', async () => {
    await useCase.execute({ productId: 'prod-01', units: 2 });

    const product = await products.findById('prod-01');
    expect(product.isOk() && product.value.stock.reserved).toBe(0);
  });

  it('warns up front when there are not enough units', async () => {
    const result = await useCase.execute({ productId: 'prod-01', units: 3 });

    expect(result.isErr() && result.error.code).toBe('INSUFFICIENT_STOCK');
    expect(result.isErr() && result.error.details).toEqual({
      productId: 'prod-01',
      requested: 3,
      available: 2,
    });
  });

  it('rejects an invalid quantity without asking the inventory', async () => {
    const result = await useCase.execute({ productId: 'prod-01', units: 11 });

    expect(result.isErr() && result.error.code).toBe('INVALID_TRANSACTION');
  });

  it('answers not found for an unknown product', async () => {
    const result = await useCase.execute({ productId: 'nope', units: 1 });

    expect(result.isErr() && result.error.code).toBe('PRODUCT_NOT_FOUND');
  });
});

describe('FindTransaction', () => {
  it('reads a stored transaction back', async () => {
    const transactions = new InMemoryTransactionRepository();
    const stored = aTransaction();
    await transactions.create(stored);

    const result = await new FindTransaction(
      transactions,
      new FakePaymentGateway(),
      new SettleTransaction(transactions, { now: (): Date => NOW }),
    ).execute(stored.id);

    expect(result.isOk() && result.value).toBe(stored);
  });

  it('answers not found for an unknown id', async () => {
    const result = await new FindTransaction(
      new InMemoryTransactionRepository(),
      new FakePaymentGateway(),
      new SettleTransaction(new InMemoryTransactionRepository(), { now: (): Date => NOW }),
    ).execute('nope');

    expect(result.isErr() && result.error.code).toBe('TRANSACTION_NOT_FOUND');
  });
});
