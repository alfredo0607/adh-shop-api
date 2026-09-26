import { FEES, NOW, TTL_MS, aTransaction } from '../__fixtures__/checkout.fixture';
import { Delivery } from './delivery';
import { Quote } from './quote';
import { Transaction } from './transaction';

describe('Delivery', () => {
  it('is assigned from the approved transaction, as PREPARING', () => {
    const transaction = aTransaction();
    const delivery = Delivery.forApproved(transaction, new Date('2026-09-24T18:00:00Z'));

    expect(delivery.transactionId).toBe(transaction.id);
    expect(delivery.status).toBe('PREPARING');
    expect(delivery.items).toEqual([{ productId: 'prod-01', name: 'Cafetera', units: 1 }]);
    expect(delivery.recipientName).toBe('Laura Gómez');
    expect(delivery.address).toBe(transaction.deliveryAddress);
  });

  it('puts every product of the order in the one parcel', () => {
    const quote = Quote.calculate({
      items: [
        { productId: 'a', name: 'Cafetera', unitPriceInCents: 100, units: 1, currency: 'COP' },
        { productId: 'b', name: 'Molino', unitPriceInCents: 200, units: 3, currency: 'COP' },
      ],
      fees: FEES,
    });
    if (quote.isErr()) throw new Error('fixture is invalid');
    const base = aTransaction();
    const transaction = Transaction.open({
      id: base.id,
      quote: quote.value,
      customer: base.customer,
      deliveryAddress: base.deliveryAddress,
      now: NOW,
      reservationTtlMs: TTL_MS,
    });

    const delivery = Delivery.forApproved(transaction, NOW);

    expect(delivery.items).toEqual([
      { productId: 'a', name: 'Cafetera', units: 1 },
      { productId: 'b', name: 'Molino', units: 3 },
    ]);
  });

  it('promises three business days, skipping the weekend', () => {
    // Thursday → Friday, Monday, Tuesday.
    const delivery = Delivery.forApproved(aTransaction(), new Date('2026-09-24T18:00:00Z'));

    expect(delivery.estimatedDeliveryAt.toISOString()).toBe('2026-09-29T18:00:00.000Z');
  });

  it('shows only the last four digits of the phone', () => {
    const delivery = Delivery.forApproved(aTransaction(), new Date());

    expect(delivery.maskedRecipientPhone).toBe('*********4567');
  });
});
