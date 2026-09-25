import { NOW, TTL_MS, aTransaction } from '../__fixtures__/checkout.fixture';
import { Transaction } from './transaction';

describe('Transaction', () => {
  it('opens as PENDING, with a reservation deadline one TTL from now', () => {
    const transaction = aTransaction();

    expect(transaction.status).toBe('PENDING');
    expect(transaction.isFinal).toBe(false);
    expect(transaction.version).toBe(0);
    expect(transaction.reservationExpiresAt.getTime()).toBe(NOW.getTime() + TTL_MS);
  });

  it('uses its id as the payment reference', () => {
    expect(aTransaction({ id: 'abc' }).reference).toBe('abc');
  });

  it('treats every status other than PENDING as final', () => {
    const open = aTransaction();
    const approved = Transaction.restore({ ...open, status: 'APPROVED' });

    expect(approved.isFinal).toBe(true);
  });
});
