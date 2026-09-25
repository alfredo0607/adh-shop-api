import type { Server } from 'node:http';

import { HttpStatus, type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '../../../../shared/infrastructure/http/all-exceptions.filter';
import { aProduct } from '../../../catalog/__fixtures__/product.fixture';
import { InMemoryProductRepository } from '../../../catalog/infrastructure/persistence/in-memory-product.repository';
import { FEES, NOW, TOTAL_FOR_ONE, TTL_MS, aCommand } from '../../__fixtures__/checkout.fixture';
import { CreateTransaction } from '../../application/create-transaction.usecase';
import { FindTransaction } from '../../application/find-transaction.usecase';
import { QuoteCheckout } from '../../application/quote-checkout.usecase';
import { CatalogInventoryAdapter } from '../inventory/catalog-inventory.adapter';
import {
  InMemoryCustomerRepository,
  InMemoryTransactionRepository,
} from '../persistence/in-memory-checkout.repositories';
import { TransactionController } from './transaction.controller';

/**
 * The HTTP contract of the checkout, through the real pipe and filter: status
 * codes, the Location header, validation, and what the response must not say.
 */
describe('TransactionController', () => {
  let app: INestApplication;
  const TRANSACTION_ID = '6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60';

  beforeAll(async () => {
    const inventory = new CatalogInventoryAdapter(
      new InMemoryProductRepository([aProduct({ id: 'prod-01', available: 3 })]),
    );
    const transactions = new InMemoryTransactionRepository();

    const moduleRef = await Test.createTestingModule({
      controllers: [TransactionController],
      providers: [
        { provide: QuoteCheckout, useValue: new QuoteCheckout(inventory, FEES) },
        {
          provide: CreateTransaction,
          useValue: new CreateTransaction(
            inventory,
            new InMemoryCustomerRepository(),
            transactions,
            { generate: (): string => TRANSACTION_ID },
            { now: (): Date => NOW },
            { fees: FEES, reservationTtlMs: TTL_MS },
          ),
        },
        { provide: FindTransaction, useValue: new FindTransaction(transactions) },
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
  const body = <T>(response: { body: unknown }): T => response.body as T;

  describe('GET /quotes', () => {
    it('prices the order and forbids caching it', async () => {
      const response = await request(server())
        .get('/quotes')
        .query({ productId: 'prod-01', units: 1 })
        .expect(200);

      expect(body<{ amounts: { totalInCents: number } }>(response).amounts.totalInCents).toBe(
        TOTAL_FOR_ONE,
      );
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('answers 409 when there are not enough units', async () => {
      const response = await request(server())
        .get('/quotes')
        .query({ productId: 'prod-01', units: 9 })
        .expect(409);

      expect(body<{ error: { code: string } }>(response).error.code).toBe('INSUFFICIENT_STOCK');
    });

    it('answers 422 for a quantity outside the allowed range', async () => {
      await request(server()).get('/quotes').query({ productId: 'prod-01', units: 50 }).expect(422);
    });
  });

  describe('POST /transactions', () => {
    it('answers 201 with a Location header and the PENDING transaction', async () => {
      const response = await request(server()).post('/transactions').send(aCommand()).expect(201);

      const created = body<{ id: string; status: string; customer: { email: string } }>(response);
      expect(response.headers['location']).toBe(`/api/v1/transactions/${TRANSACTION_ID}`);
      expect(created.status).toBe('PENDING');
      // The full address and the phone number are held for delivery, not echoed.
      expect(created.customer.email).toBe('l***@example.com');
      expect(JSON.stringify(created)).not.toContain('3001234567');
    });

    it('rejects a client-supplied amount field instead of ignoring it', async () => {
      await request(server())
        .post('/transactions')
        .send({ ...aCommand(), totalInCents: 1 })
        .expect(422);
    });

    it('answers 422 AMOUNT_MISMATCH when the total the buyer saw is stale', async () => {
      const response = await request(server())
        .post('/transactions')
        .send(aCommand({ expectedTotalInCents: 1 }))
        .expect(422);

      expect(body<{ error: { code: string } }>(response).error.code).toBe('AMOUNT_MISMATCH');
    });

    it('answers 422 when the nested customer is missing', async () => {
      await request(server())
        .post('/transactions')
        .send({ ...aCommand(), customer: undefined })
        .expect(422);
    });
  });

  describe('GET /transactions/:id', () => {
    it('reads the transaction back, uncached', async () => {
      const response = await request(server()).get(`/transactions/${TRANSACTION_ID}`).expect(200);

      expect(body<{ id: string }>(response).id).toBe(TRANSACTION_ID);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('answers 404 for an unknown id', async () => {
      await request(server()).get('/transactions/0b7e5c1a-2d3f-4a5b-8c6d-7e8f9a0b1c2d').expect(404);
    });

    it('answers 400 for an id that is not a UUID', async () => {
      await request(server()).get('/transactions/not-an-id').expect(400);
    });
  });
});
