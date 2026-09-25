import { createHash } from 'node:crypto';

import { z } from 'zod';

import { ResultAsync, err, ok, type Result } from '../../../../shared/domain';
import { PaymentGatewayUnavailable, PaymentRejected } from '../../domain/checkout.errors';
import type {
  CardCharge,
  GatewayPayment,
  PaymentGatewayPort,
  PaymentTerms,
} from '../../domain/payment-gateway.port';

export interface PaymentGatewayConfig {
  readonly baseUrl: string;
  readonly publicKey: string;
  readonly privateKey: string;
  readonly integritySecret: string;
  readonly timeoutMs: number;
}

// The gateway's responses are parsed, not trusted. A field that changes type
// upstream should fail here with a clear message, not three calls later as
// `undefined` inside an amount.
const acceptanceSchema = z.object({ acceptance_token: z.string(), permalink: z.string().url() });

const merchantSchema = z.object({
  data: z.object({
    presigned_acceptance: acceptanceSchema,
    presigned_personal_data_auth: acceptanceSchema,
  }),
});

const paymentSchema = z.object({
  data: z.object({
    id: z.string(),
    status: z.enum(['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR']),
    amount_in_cents: z.number().int(),
  }),
});

const paymentListSchema = z.object({ data: z.array(paymentSchema.shape.data) });

const errorSchema = z.object({
  error: z.object({
    type: z.string(),
    messages: z.record(z.unknown()).optional(),
  }),
});

interface RawResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * The payment gateway, over its REST API.
 *
 * Card data never passes through here. The storefront turns the card into a
 * token directly with the gateway, using the public key, and this adapter only
 * ever handles that token.
 */
export class HttpPaymentGateway implements PaymentGatewayPort {
  constructor(private readonly config: PaymentGatewayConfig) {}

  terms(): ResultAsync<PaymentTerms, PaymentGatewayUnavailable> {
    return this.send('GET', `/merchants/${this.config.publicKey}`).andThen((response) => {
      const parsed = merchantSchema.safeParse(response.body);

      if (response.status !== 200 || !parsed.success) {
        return err(unexpected('merchant terms', response));
      }

      const { presigned_acceptance: acceptance, presigned_personal_data_auth: personal } =
        parsed.data.data;

      return ok({
        publicKey: this.config.publicKey,
        cardTokenizationUrl: `${this.config.baseUrl}/tokens/cards`,
        acceptance: { token: acceptance.acceptance_token, documentUrl: acceptance.permalink },
        personalDataAuthorization: {
          token: personal.acceptance_token,
          documentUrl: personal.permalink,
        },
      });
    });
  }

  charge(
    request: CardCharge,
  ): ResultAsync<GatewayPayment, PaymentRejected | PaymentGatewayUnavailable> {
    const body = {
      acceptance_token: request.acceptanceToken,
      accept_personal_auth: request.personalDataAuthorizationToken,
      amount_in_cents: request.amountInCents,
      currency: request.currency,
      signature: this.integritySignature(request),
      customer_email: request.customerEmail,
      reference: request.reference,
      payment_method: {
        type: 'CARD',
        token: request.cardToken,
        installments: request.installments,
      },
    };

    return this.send('POST', '/transactions', body, this.config.privateKey).andThen(
      (response): Result<GatewayPayment, PaymentRejected | PaymentGatewayUnavailable> => {
        if (response.status >= 400 && response.status < 500) {
          return err(rejection(response));
        }

        return toPayment(response);
      },
    );
  }

  find(gatewayTransactionId: string): ResultAsync<GatewayPayment, PaymentGatewayUnavailable> {
    return this.send('GET', `/transactions/${encodeURIComponent(gatewayTransactionId)}`).andThen(
      toPayment,
    );
  }

  findByReference(
    reference: string,
  ): ResultAsync<GatewayPayment | undefined, PaymentGatewayUnavailable> {
    return this.send(
      'GET',
      `/transactions?reference=${encodeURIComponent(reference)}`,
      undefined,
      // Searching by reference is a merchant operation: it needs the private key.
      this.config.privateKey,
    ).andThen((response): Result<GatewayPayment | undefined, PaymentGatewayUnavailable> => {
      const parsed = paymentListSchema.safeParse(response.body);

      if (response.status !== 200 || !parsed.success) {
        return err(unexpected('payment search', response));
      }

      // References are unique on our side, so more than one match should not
      // happen. If it does, an approval is the fact that must not be lost.
      const found =
        parsed.data.data.find((payment) => payment.status === 'APPROVED') ?? parsed.data.data[0];

      return ok(
        found === undefined
          ? undefined
          : {
              gatewayTransactionId: found.id,
              status: found.status,
              amountInCents: found.amount_in_cents,
            },
      );
    });
  }

  /**
   * Proves to the gateway that the amount was set by this server.
   *
   * Without it, a payment request could be replayed with the amount edited.
   * The secret never leaves the server, so only this service can produce a
   * valid signature for a given reference and amount.
   */
  private integritySignature(request: CardCharge): string {
    return createHash('sha256')
      .update(
        `${request.reference}${request.amountInCents}${request.currency}${this.config.integritySecret}`,
      )
      .digest('hex');
  }

  private send(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    bearer?: string,
  ): ResultAsync<RawResponse, PaymentGatewayUnavailable> {
    const request = async (): Promise<RawResponse> => {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // A payment call that hangs holds the buyer's screen and a server
        // connection with it. Past the timeout the outcome is settled later
        // from the gateway's own report.
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      const text = await response.text();
      let parsed: unknown = undefined;
      try {
        parsed = text === '' ? undefined : JSON.parse(text);
      } catch {
        parsed = text;
      }

      return { status: response.status, body: parsed };
    };

    return ResultAsync.fromPromise(
      request(),
      (cause) =>
        new PaymentGatewayUnavailable(`Payment gateway unreachable (${method} ${path})`, cause),
    );
  }
}

const toPayment = (response: RawResponse): Result<GatewayPayment, PaymentGatewayUnavailable> => {
  const parsed = paymentSchema.safeParse(response.body);

  if (response.status >= 300 || !parsed.success) {
    return err(unexpected('payment', response));
  }

  return ok({
    gatewayTransactionId: parsed.data.data.id,
    status: parsed.data.data.status,
    amountInCents: parsed.data.data.amount_in_cents,
  });
};

/**
 * Reports which fields the gateway objected to, not what it said about them.
 * Its messages are written for the merchant and can echo submitted values.
 */
const rejection = (response: RawResponse): PaymentRejected => {
  const parsed = errorSchema.safeParse(response.body);

  return new PaymentRejected(
    'The payment gateway refused the payment request',
    parsed.success
      ? { reason: parsed.data.error.type, fields: Object.keys(parsed.data.error.messages ?? {}) }
      : { reason: 'UNKNOWN' },
  );
};

const unexpected = (what: string, response: RawResponse): PaymentGatewayUnavailable =>
  new PaymentGatewayUnavailable(
    `Unexpected ${what} response from the payment gateway (HTTP ${response.status})`,
    response.body,
  );
