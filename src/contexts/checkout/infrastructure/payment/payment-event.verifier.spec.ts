import {
  EVENTS_SECRET,
  EVENT_RECEIVED_AT,
  EVENT_TIMESTAMP,
  signedEvent,
} from '../../__fixtures__/payment-event.fixture';
import { PaymentEventVerifier } from './payment-event.verifier';

describe('PaymentEventVerifier', () => {
  const verifier = new PaymentEventVerifier(EVENTS_SECRET, () => EVENT_RECEIVED_AT);

  it('reads the outcome out of an authentic event', () => {
    const result = verifier.verify(signedEvent());

    expect(result.isOk() && result.value).toEqual({
      reference: 'ref-1',
      gatewayTransactionId: 'gw-1',
      status: 'APPROVED',
      amountInCents: 9_169_000,
    });
  });

  it('refuses an event signed with another secret', () => {
    const result = verifier.verify(signedEvent({ secret: 'guessed' }));

    expect(result.isErr() && result.error.code).toBe('INVALID_PAYMENT_EVENT');
  });

  it('refuses an event whose signed values were edited', () => {
    const event = signedEvent({ status: 'DECLINED' });
    (event['data'] as { transaction: { status: string } }).transaction.status = 'APPROVED';

    expect(verifier.verify(event).isErr()).toBe(true);
  });

  it('refuses a replay of an old event', () => {
    const old = signedEvent({
      timestamp: EVENT_TIMESTAMP - PaymentEventVerifier.MAX_AGE_SECONDS - 60,
    });

    expect(verifier.verify(old).isErr()).toBe(true);
  });

  it('refuses an event that signs a property it does not carry', () => {
    const event = signedEvent();
    (event['signature'] as { properties: string[] }).properties.push('transaction.missing');

    expect(verifier.verify(event).isErr()).toBe(true);
  });

  it.each([
    ['not an object', 'hello'],
    ['no signature', { event: 'transaction.updated', data: {}, timestamp: EVENT_TIMESTAMP }],
  ])('refuses a malformed event: %s', (_case, payload) => {
    expect(verifier.verify(payload).isErr()).toBe(true);
  });

  it('acknowledges an authentic event of another kind without acting on it', () => {
    const result = verifier.verify(signedEvent({ event: 'nequi_token.updated' }));

    expect(result.isOk() && result.value).toBeUndefined();
  });
});
