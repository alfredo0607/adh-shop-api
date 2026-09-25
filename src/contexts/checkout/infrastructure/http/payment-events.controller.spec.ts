import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { ResultAsync } from '../../../../shared/domain';
import { AllExceptionsFilter } from '../../../../shared/infrastructure/http/all-exceptions.filter';
import { SettleTransaction } from '../../application/settle-transaction.usecase';
import {
  EVENTS_SECRET,
  EVENT_RECEIVED_AT,
  signedEvent,
} from '../../__fixtures__/payment-event.fixture';
import { CheckoutUnavailable, TransactionNotFound } from '../../domain/checkout.errors';
import { PaymentEventVerifier } from '../payment/payment-event.verifier';

import { InMemoryTransactionRepository } from '../persistence/in-memory-checkout.repositories';
import { PAYMENT_EVENT_VERIFIER, PaymentEventsController } from './payment-events.controller';

describe('PaymentEventsController', () => {
  let app: INestApplication;
  const settle = new SettleTransaction(new InMemoryTransactionRepository(), {
    now: (): Date => new Date(),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentEventsController],
      providers: [
        {
          provide: PAYMENT_EVENT_VERIFIER,
          useValue: new PaymentEventVerifier(EVENTS_SECRET, () => EVENT_RECEIVED_AT),
        },
        { provide: SettleTransaction, useValue: settle },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const post = (body: unknown): request.Test =>
    request(app.getHttpServer() as Server)
      .post('/payment-events')
      .send(body as object);

  it('settles the transaction named by an authentic event', async () => {
    const execute = jest
      .spyOn(settle, 'execute')
      .mockReturnValue(ResultAsync.err(new TransactionNotFound('ref-1')));

    await post(signedEvent()).expect(200, { received: true });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'ref-1', status: 'APPROVED' }),
    );
  });

  it('refuses a forged event with 401, and settles nothing', async () => {
    const execute = jest.spyOn(settle, 'execute');

    await post(signedEvent({ secret: 'guessed' })).expect(401);

    expect(execute).not.toHaveBeenCalled();
  });

  it('acknowledges an event it can never apply, so the gateway stops redelivering it', async () => {
    jest
      .spyOn(settle, 'execute')
      .mockReturnValue(ResultAsync.err(new TransactionNotFound('ref-1')));

    await post(signedEvent()).expect(200);
  });

  it('asks for redelivery when the failure is transient', async () => {
    jest
      .spyOn(settle, 'execute')
      .mockReturnValue(ResultAsync.err(new CheckoutUnavailable('store down')));

    await post(signedEvent()).expect(503);
  });

  it('acknowledges an authentic event of a kind it ignores', async () => {
    const execute = jest.spyOn(settle, 'execute');

    await post(signedEvent({ event: 'nequi_token.updated' })).expect(200);

    expect(execute).not.toHaveBeenCalled();
  });
});
