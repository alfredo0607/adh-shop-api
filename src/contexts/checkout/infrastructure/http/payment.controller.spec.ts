import type { Server } from 'node:http';

import { HttpStatus, type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { ResultAsync } from '../../../../shared/domain';
import { AllExceptionsFilter } from '../../../../shared/infrastructure/http/all-exceptions.filter';
import { IdempotencyInterceptor } from '../../../../shared/infrastructure/idempotency/idempotency.interceptor';
import { IDEMPOTENCY_STORE } from '../../../../shared/infrastructure/idempotency/idempotency.store';
import { InMemoryIdempotencyStore } from '../../../../shared/infrastructure/idempotency/in-memory-idempotency.store';
import { NOW, aTransaction } from '../../__fixtures__/checkout.fixture';
import { GetPaymentTerms } from '../../application/get-payment-terms.usecase';
import { PayTransaction } from '../../application/pay-transaction.usecase';
import { PaymentGatewayUnavailable } from '../../domain/checkout.errors';
import { FakePaymentGateway } from '../payment/fake-payment.gateway';
import { InMemoryTransactionRepository } from '../persistence/in-memory-checkout.repositories';
import { PaymentController } from './payment.controller';

describe('PaymentController', () => {
  let app: INestApplication;
  const gateway = new FakePaymentGateway();
  const transactions = new InMemoryTransactionRepository();
  const idempotency = new InMemoryIdempotencyStore();

  const ID = '6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60';
  const body = {
    cardToken: 'tok_test_123',
    installments: 1,
    acceptanceToken: 'acceptance',
    personalDataAuthorizationToken: 'personal-data',
  };

  // One application for the suite; only the state is reset between tests.
  // Compiling a Nest module per test is slow enough to hit the timeout on a
  // loaded machine.
  beforeEach(async () => {
    transactions.byId.clear();
    idempotency.entries.clear();
    gateway.charges.length = 0;
    gateway.nextCharge = ResultAsync.ok({ gatewayTransactionId: 'gw-1', status: 'PENDING' });
    await transactions.create(aTransaction({ id: ID }));
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        { provide: GetPaymentTerms, useValue: new GetPaymentTerms(gateway) },
        {
          provide: PayTransaction,
          useValue: new PayTransaction(transactions, gateway, {
            now: (): Date => new Date(NOW.getTime() + 60_000),
          }),
        },
        { provide: IDEMPOTENCY_STORE, useValue: idempotency },
        IdempotencyInterceptor,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = (): Server => app.getHttpServer() as Server;
  const pay = (key?: string): request.Test => {
    const call = request(server()).post(`/transactions/${ID}/payment`);
    return key === undefined ? call : call.set('Idempotency-Key', key);
  };
  const KEY = '0b7e5c1a-2d3f-4a5b-8c6d-7e8f9a0b1c2d';

  describe('GET /payment-terms', () => {
    it('serves the terms uncached', async () => {
      const response = await request(server()).get('/payment-terms').expect(200);

      expect((response.body as { publicKey: string }).publicKey).toBe('pub_test');
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('POST /transactions/:id/payment', () => {
    it('answers 202 with the transaction marked as submitted', async () => {
      const response = await pay(KEY).send(body).expect(202);

      expect(response.body).toMatchObject({ id: ID, status: 'PENDING', paymentSubmitted: true });
    });

    it('replays the original response for a retry, without charging again', async () => {
      const first = await pay(KEY).send(body).expect(202);
      const retry = await pay(KEY).send(body).expect(202);

      expect(retry.body).toEqual(first.body);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(gateway.charges).toHaveLength(1);
    });

    it('refuses the same key for a different request', async () => {
      await pay(KEY).send(body).expect(202);

      const response = await pay(KEY)
        .send({ ...body, cardToken: 'tok_other' })
        .expect(422);

      expect((response.body as { error: { code: string } }).error.code).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
    });

    it('refuses a second payment under a new key', async () => {
      await pay(KEY).send(body).expect(202);

      const response = await pay('1c8f6d2b-3e4a-4b5c-9d7e-8f9a0b1c2d3e').send(body).expect(409);

      expect((response.body as { error: { code: string } }).error.code).toBe(
        'TRANSACTION_NOT_PAYABLE',
      );
    });

    it('forgets a failed request, so the same key can be retried', async () => {
      gateway.nextCharge = ResultAsync.err(new PaymentGatewayUnavailable('timeout'));
      await pay(KEY).send(body).expect(503);

      expect(idempotency.entries.has(KEY)).toBe(false);
    });

    it('requires an Idempotency-Key', async () => {
      await pay().send(body).expect(400);
      await pay('short').send(body).expect(400);
      expect(gateway.charges).toHaveLength(0);
    });

    it('refuses card data in place of a token', async () => {
      await pay(KEY)
        .send({ ...body, cardToken: '4242424242424242' })
        .expect(422);
      await pay('2d9f7e3c-4f5b-4c6d-8e8f-9a0b1c2d3e4f')
        .send({ ...body, cardNumber: '4242424242424242' })
        .expect(422);
    });
  });
});
