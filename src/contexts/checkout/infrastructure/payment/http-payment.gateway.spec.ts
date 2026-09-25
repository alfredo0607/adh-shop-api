import { createHash } from 'node:crypto';

import { HttpPaymentGateway } from './http-payment.gateway';

describe('HttpPaymentGateway', () => {
  const config = {
    baseUrl: 'https://gateway.test/v1',
    publicKey: 'pub_test_key',
    privateKey: 'prv_test_key',
    integritySecret: 'integrity_secret',
    timeoutMs: 1_000,
  };

  const charge = {
    reference: 'ref-1',
    amountInCents: 9_169_000,
    currency: 'COP',
    customerEmail: 'laura@example.com',
    cardToken: 'tok_test_1',
    installments: 1,
    acceptanceToken: 'acceptance',
    personalDataAuthorizationToken: 'personal',
  };

  let fetchMock: jest.SpyInstance;

  const respond = (status: number, body: unknown): void => {
    fetchMock.mockResolvedValue(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );
  };

  const sentRequest = (): {
    url: string;
    init: RequestInit & { headers: Record<string, string> };
  } => {
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    return { url, init };
  };

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  describe('terms', () => {
    it('reads the acceptance documents and says where to tokenise cards', async () => {
      respond(200, {
        data: {
          presigned_acceptance: {
            acceptance_token: 'a-1',
            permalink: 'https://docs.test/terms.pdf',
          },
          presigned_personal_data_auth: {
            acceptance_token: 'p-1',
            permalink: 'https://docs.test/data.pdf',
          },
        },
      });

      const result = await new HttpPaymentGateway(config).terms();

      expect(sentRequest().url).toBe('https://gateway.test/v1/merchants/pub_test_key');
      expect(result.isOk() && result.value).toEqual({
        publicKey: 'pub_test_key',
        cardTokenizationUrl: 'https://gateway.test/v1/tokens/cards',
        acceptance: { token: 'a-1', documentUrl: 'https://docs.test/terms.pdf' },
        personalDataAuthorization: { token: 'p-1', documentUrl: 'https://docs.test/data.pdf' },
      });
    });

    it('treats a response of an unexpected shape as the gateway being unavailable', async () => {
      respond(200, { data: { something: 'else' } });

      const result = await new HttpPaymentGateway(config).terms();

      expect(result.isErr() && result.error.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
    });
  });

  describe('charge', () => {
    it('signs the amount with the integrity secret and authenticates with the private key', async () => {
      respond(201, { data: { id: 'gw-1', status: 'PENDING', amount_in_cents: 9_169_000 } });

      const result = await new HttpPaymentGateway(config).charge(charge);

      const { url, init } = sentRequest();
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const expected = createHash('sha256').update('ref-19169000COPintegrity_secret').digest('hex');

      expect(url).toBe('https://gateway.test/v1/transactions');
      expect(init.headers['Authorization']).toBe('Bearer prv_test_key');
      expect(body['signature']).toBe(expected);
      expect(body['amount_in_cents']).toBe(9_169_000);
      expect(body['payment_method']).toEqual({
        type: 'CARD',
        token: 'tok_test_1',
        installments: 1,
      });
      expect(result.isOk() && result.value).toEqual({
        gatewayTransactionId: 'gw-1',
        status: 'PENDING',
        amountInCents: 9_169_000,
      });
    });

    it('reports which fields were refused, but not what the gateway said about them', async () => {
      respond(422, {
        error: {
          type: 'INPUT_VALIDATION_ERROR',
          messages: { acceptance_token: ['El token de aceptación ya fue usado: a-1'] },
        },
      });

      const result = await new HttpPaymentGateway(config).charge(charge);

      expect(result.isErr() && result.error.code).toBe('PAYMENT_REJECTED');
      expect(result.isErr() && result.error.details).toEqual({
        reason: 'INPUT_VALIDATION_ERROR',
        fields: ['acceptance_token'],
      });
    });

    it('rejects even when the error body is not the documented shape', async () => {
      respond(400, 'Bad Request');

      const result = await new HttpPaymentGateway(config).charge(charge);

      expect(result.isErr() && result.error.details).toEqual({ reason: 'UNKNOWN' });
    });

    it('treats a server error as the gateway being unavailable', async () => {
      respond(502, '');

      const result = await new HttpPaymentGateway(config).charge(charge);

      expect(result.isErr() && result.error.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
    });

    it('keeps a network failure or timeout on the railway', async () => {
      fetchMock.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));

      const result = await new HttpPaymentGateway(config).charge(charge);

      expect(result.isErr() && result.error.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
    });
  });

  describe('findByReference', () => {
    it('searches with the private key, preferring an approval if there are several', async () => {
      respond(200, {
        data: [
          { id: 'gw-1', status: 'DECLINED', amount_in_cents: 100 },
          { id: 'gw-2', status: 'APPROVED', amount_in_cents: 100 },
        ],
      });

      const result = await new HttpPaymentGateway(config).findByReference('ref 1');

      expect(sentRequest().url).toBe('https://gateway.test/v1/transactions?reference=ref%201');
      expect(sentRequest().init.headers['Authorization']).toBe('Bearer prv_test_key');
      expect(result.isOk() && result.value?.gatewayTransactionId).toBe('gw-2');
    });

    it('answers undefined when the gateway has no such payment', async () => {
      respond(200, { data: [] });

      const result = await new HttpPaymentGateway(config).findByReference('ref-1');

      expect(result.isOk() && result.value).toBeUndefined();
    });

    it('treats an unexpected answer as the gateway being unavailable', async () => {
      respond(401, { error: { type: 'NOT_AUTHORIZED' } });

      const result = await new HttpPaymentGateway(config).findByReference('ref-1');

      expect(result.isErr() && result.error.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
    });
  });

  describe('find', () => {
    it('reads the status of a payment', async () => {
      respond(200, { data: { id: 'gw 1', status: 'APPROVED', amount_in_cents: 100 } });

      const result = await new HttpPaymentGateway(config).find('gw 1');

      expect(sentRequest().url).toBe('https://gateway.test/v1/transactions/gw%201');
      expect(result.isOk() && result.value.status).toBe('APPROVED');
    });

    it('refuses a status it does not know rather than guessing', async () => {
      respond(200, { data: { id: 'gw-1', status: 'REFUNDED', amount_in_cents: 100 } });

      const result = await new HttpPaymentGateway(config).find('gw-1');

      expect(result.isErr() && result.error.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
    });
  });
});
