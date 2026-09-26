import type { CreateTransactionCommand } from '../application/create-transaction.usecase';
import { Customer } from '../domain/customer';
import { DeliveryAddress } from '../domain/delivery-address';
import { Quote } from '../domain/quote';
import { Transaction } from '../domain/transaction';

export const FEES = { baseFeeInCents: 500_00, deliveryFeeInCents: 1_200_00 };
export const NOW = new Date('2026-09-24T18:00:00.000Z');
export const TTL_MS = 15 * 60_000;

/** 150_000 unit price, one unit, plus both fees. */
export const TOTAL_FOR_ONE = 150_000 + 500_00 + 1_200_00;

export const aCommand = (
  overrides: Partial<CreateTransactionCommand> = {},
): CreateTransactionCommand => ({
  items: [{ productId: 'prod-01', units: 1 }],
  expectedTotalInCents: TOTAL_FOR_ONE,
  customer: { fullName: 'Laura Gómez', email: 'Laura@Example.com', phone: '+57 300 123 4567' },
  deliveryAddress: {
    addressLine1: 'Calle 93 # 11-26',
    addressLine2: 'Apartamento 502',
    city: 'Bogotá',
    region: 'Cundinamarca',
    postalCode: '110221',
    country: 'co',
  },
  ...overrides,
});

/** Builds a valid transaction, throwing if the fixture itself is wrong. */
export const aTransaction = (overrides: { id?: string } = {}): Transaction => {
  const quote = Quote.calculate({
    items: [
      {
        productId: 'prod-01',
        name: 'Cafetera',
        unitPriceInCents: 150_000,
        units: 1,
        currency: 'COP',
      },
    ],
    fees: FEES,
  });
  const address = DeliveryAddress.create(aCommand().deliveryAddress);

  if (quote.isErr() || address.isErr()) {
    throw new Error('transaction fixture is invalid');
  }

  return Transaction.open({
    id: overrides.id ?? '6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60',
    quote: quote.value,
    customer: Customer.restore({
      id: 'customer-1',
      fullName: 'Laura Gómez',
      email: 'laura@example.com',
      phone: '+573001234567',
    }),
    deliveryAddress: address.value,
    now: NOW,
    reservationTtlMs: TTL_MS,
  });
};
