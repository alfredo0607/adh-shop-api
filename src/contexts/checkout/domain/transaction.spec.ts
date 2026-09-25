import { NOW, TTL_MS, aTransaction } from '../__fixtures__/checkout.fixture';
import { Transaction } from './transaction';

describe('Transaction', () => {
  const later = (ms: number): Date => new Date(NOW.getTime() + ms);

  it('opens as PENDING, with a reservation deadline one TTL from now', () => {
    const transaction = aTransaction();

    expect(transaction.status).toBe('PENDING');
    expect(transaction.isFinal).toBe(false);
    expect(transaction.paymentSubmitted).toBe(false);
    expect(transaction.version).toBe(0);
    expect(transaction.reservationExpiresAt.getTime()).toBe(NOW.getTime() + TTL_MS);
  });

  it('uses its id as the payment reference', () => {
    expect(aTransaction({ id: 'abc' }).reference).toBe('abc');
  });

  describe('claimPayment', () => {
    it('marks the attempt and bumps the version', () => {
      const result = aTransaction().claimPayment(later(1_000));

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.paymentSubmitted).toBe(true);
      expect(result.value.paymentClaimedAt).toEqual(later(1_000));
      expect(result.value.version).toBe(1);
    });

    it('allows exactly one attempt', () => {
      const claimed = aTransaction().claimPayment(later(1_000));
      if (claimed.isErr()) throw new Error('first claim should succeed');

      const second = claimed.value.claimPayment(later(2_000));

      expect(second.isErr() && second.error.details).toEqual({
        transactionId: claimed.value.id,
        reason: 'ALREADY_SUBMITTED',
      });
    });

    it('refuses once the reservation has expired, even by a millisecond', () => {
      const result = aTransaction().claimPayment(later(TTL_MS));

      expect(result.isErr() && result.error.code).toBe('RESERVATION_EXPIRED');
    });

    it('refuses a transaction that is already final', () => {
      const approved = aTransaction();
      const final = Transaction.restore({
        id: approved.id,
        status: 'APPROVED',
        product: approved.product,
        quote: approved.quote,
        customer: approved.customer,
        deliveryAddress: approved.deliveryAddress,
        createdAt: approved.createdAt,
        updatedAt: approved.updatedAt,
        reservationExpiresAt: approved.reservationExpiresAt,
        version: 3,
      });

      const result = final.claimPayment(later(1_000));

      expect(final.isFinal).toBe(true);
      expect(result.isErr() && result.error.code).toBe('TRANSACTION_NOT_PAYABLE');
    });
  });

  describe('expire', () => {
    it('closes an unpaid reservation once its deadline has passed', () => {
      expect(aTransaction().expire(later(TTL_MS))?.status).toBe('EXPIRED');
    });

    it('does not expire before the deadline', () => {
      expect(aTransaction().expire(later(TTL_MS - 1))).toBeUndefined();
    });

    it('does not expire a payment in flight unless told it was abandoned', () => {
      const claimed = aTransaction().claimPayment(later(1_000));
      if (claimed.isErr()) throw new Error('claim should succeed');

      expect(claimed.value.expire(later(TTL_MS))).toBeUndefined();
      expect(claimed.value.expire(later(TTL_MS), { paymentAbandoned: true })?.status).toBe(
        'EXPIRED',
      );
    });

    it('never touches a final transaction', () => {
      const approved = aTransaction().settle('APPROVED', later(1_000));

      expect(approved?.expire(later(TTL_MS))).toBeUndefined();
      expect(approved?.settle('DECLINED', later(2_000))).toBeUndefined();
    });
  });

  it('records the gateway id, and can release a claim that charged nothing', () => {
    const claimed = aTransaction().claimPayment(later(1_000));
    if (claimed.isErr()) throw new Error('claim should succeed');

    const recorded = claimed.value.recordGatewayPayment('gw-1', later(2_000));
    const released = claimed.value.releasePaymentClaim(later(2_000));

    expect(recorded.gatewayTransactionId).toBe('gw-1');
    expect(recorded.version).toBe(2);
    expect(released.paymentSubmitted).toBe(false);
    expect(released.updatedAt).toEqual(later(2_000));
  });
});
