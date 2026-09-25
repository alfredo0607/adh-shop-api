import { aTransaction } from '../__fixtures__/checkout.fixture';
import { Delivery } from './delivery';

describe('Delivery', () => {
  it('is assigned from the approved transaction, as PREPARING', () => {
    const transaction = aTransaction();
    const delivery = Delivery.forApproved(transaction, new Date('2026-09-24T18:00:00Z'));

    expect(delivery.transactionId).toBe(transaction.id);
    expect(delivery.status).toBe('PREPARING');
    expect(delivery.units).toBe(1);
    expect(delivery.recipientName).toBe('Laura Gómez');
    expect(delivery.address).toBe(transaction.deliveryAddress);
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
