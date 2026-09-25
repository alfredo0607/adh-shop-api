import { createHash } from 'node:crypto';

export const EVENTS_SECRET = 'events_secret';
export const EVENT_TIMESTAMP = 1_790_000_000;
/** Five seconds after the event was signed. */
export const EVENT_RECEIVED_AT = new Date(EVENT_TIMESTAMP * 1000 + 5_000);

/** Builds an event exactly as the gateway signs it. */
export const signedEvent = (
  overrides: { status?: string; secret?: string; timestamp?: number; event?: string } = {},
): Record<string, unknown> => {
  const transaction = {
    id: 'gw-1',
    reference: 'ref-1',
    status: overrides.status ?? 'APPROVED',
    amount_in_cents: 9_169_000,
  };
  const timestamp = overrides.timestamp ?? EVENT_TIMESTAMP;
  const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
  const checksum = createHash('sha256')
    .update(
      `${transaction.id}${transaction.status}${transaction.amount_in_cents}${timestamp}${overrides.secret ?? EVENTS_SECRET}`,
    )
    .digest('hex')
    .toUpperCase();

  return {
    event: overrides.event ?? 'transaction.updated',
    data: { transaction },
    environment: 'test',
    signature: { properties, checksum },
    timestamp,
    sent_at: new Date(timestamp * 1000).toISOString(),
  };
};
