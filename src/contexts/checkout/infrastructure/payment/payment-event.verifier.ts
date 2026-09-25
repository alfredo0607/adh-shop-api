import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { type Result, err, ok } from '../../../../shared/domain';
import type { PaymentOutcome } from '../../application/settle-transaction.usecase';
import { InvalidPaymentEvent } from '../../domain/checkout.errors';

const eventSchema = z.object({
  event: z.string(),
  data: z.record(z.unknown()),
  signature: z.object({
    properties: z.array(z.string()).min(1),
    checksum: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  }),
  timestamp: z.number().int(),
});

const transactionSchema = z.object({
  id: z.string(),
  reference: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR']),
  amount_in_cents: z.number().int(),
});

/**
 * Authenticates the gateway's payment events and reads the outcome out of them.
 *
 * The webhook URL is public, so anyone can post to it. Without this check a
 * forged "APPROVED" would ship a product nobody paid for. The gateway signs
 * each event with a secret only it and this service know: a SHA-256 over the
 * values of the listed properties, the timestamp and the secret.
 */
export class PaymentEventVerifier {
  /**
   * Events older than this are refused, so a captured event cannot be replayed
   * later. Generous, because the gateway retries a failed delivery for a while.
   */
  static readonly MAX_AGE_SECONDS = 24 * 60 * 60;

  constructor(
    private readonly eventsSecret: string,
    private readonly now: () => Date,
  ) {}

  /**
   * Resolves to the outcome, or to `undefined` for an authentic event this
   * service has no use for — which must still be acknowledged, or the gateway
   * keeps redelivering it.
   */
  verify(payload: unknown): Result<PaymentOutcome | undefined, InvalidPaymentEvent> {
    const parsed = eventSchema.safeParse(payload);

    if (!parsed.success) {
      return err(new InvalidPaymentEvent('The payment event is malformed'));
    }

    const event = parsed.data;
    const values = event.signature.properties.map((path) => valueAt(event.data, path));

    if (values.some((value) => value === undefined)) {
      return err(new InvalidPaymentEvent('The payment event signs a property it does not carry'));
    }

    const expected = createHash('sha256')
      .update(`${values.join('')}${event.timestamp}${this.eventsSecret}`)
      .digest();
    const received = Buffer.from(event.signature.checksum, 'hex');

    // Constant time: a plain comparison returns sooner the earlier a byte
    // differs, which leaks, one byte at a time, how close a forgery is.
    if (!timingSafeEqual(expected, received)) {
      return err(new InvalidPaymentEvent('The payment event signature is not valid'));
    }

    const ageSeconds = this.now().getTime() / 1000 - event.timestamp;
    if (ageSeconds > PaymentEventVerifier.MAX_AGE_SECONDS) {
      return err(new InvalidPaymentEvent('The payment event is too old to be trusted'));
    }

    if (event.event !== 'transaction.updated') {
      return ok(undefined);
    }

    const transaction = transactionSchema.safeParse(event.data['transaction']);
    if (!transaction.success) {
      return err(new InvalidPaymentEvent('The payment event carries no transaction'));
    }

    return ok({
      reference: transaction.data.reference,
      gatewayTransactionId: transaction.data.id,
      status: transaction.data.status,
      amountInCents: transaction.data.amount_in_cents,
    });
  }
}

/** Reads "transaction.status" out of the event's data object. */
const valueAt = (data: Record<string, unknown>, path: string): string | undefined => {
  let current: unknown = data;

  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean'
    ? String(current)
    : undefined;
};
