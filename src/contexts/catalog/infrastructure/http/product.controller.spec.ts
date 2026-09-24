import type { Server } from 'node:http';

import { HttpStatus, type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '../../../../shared/infrastructure/http/all-exceptions.filter';
import { FindProduct } from '../../application/find-product.usecase';
import { IMAGE_URL_SIGNER, type ImageUrlSigner } from '../../application/image-url-signer.port';
import { ListProducts } from '../../application/list-products.usecase';
import { aProduct } from '../../__fixtures__/product.fixture';
import { InMemoryProductRepository } from '../persistence/in-memory-product.repository';
import { ProductController } from './product.controller';

/**
 * Exercises the HTTP contract: status codes, response shape and validation.
 *
 * Runs the real controller, the real pipe and the real exception filter over an
 * in-memory repository. Unit testing the controller by calling its method
 * directly would skip every one of those, which is where the contract actually
 * lives — a wrong status code or a leaked internal field is invisible until a
 * request goes through the pipeline.
 */
describe('ProductController', () => {
  let app: INestApplication;

  const fakeSigner: ImageUrlSigner = {
    sign: (imageKey) => `https://cdn.test/${imageKey}?signed`,
  };

  beforeAll(async () => {
    const repository = new InMemoryProductRepository([
      aProduct({ id: 'prod-01', available: 10, priceInCents: 150_000 }),
      aProduct({ id: 'prod-02', available: 5 }),
      aProduct({ id: 'prod-03', available: 0, reserved: 3 }),
    ]);

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductController],
      providers: [
        { provide: ListProducts, useValue: new ListProducts(repository) },
        { provide: FindProduct, useValue: new FindProduct(repository) },
        { provide: IMAGE_URL_SIGNER, useValue: fakeSigner },
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

  // supertest types the body as `any`. Narrowing once here keeps the
  // assertions readable and the linter satisfied.
  interface ProductBody {
    id: string;
    priceInCents: number;
    availableUnits: number;
    isPurchasable: boolean;
    imageUrl: string;
  }
  interface PageBody {
    items: ProductBody[];
    nextCursor: string | null;
  }
  interface ErrorBody {
    error: { code: string; message: string };
    requestId: string;
  }

  const page = (body: unknown): PageBody => body as PageBody;
  const product = (body: unknown): ProductBody => body as ProductBody;
  const failure = (body: unknown): ErrorBody => body as ErrorBody;

  describe('GET /products', () => {
    it('answers 200 with a page of products', async () => {
      const response = await request(server()).get('/products').expect(200);

      expect(page(response.body).items).toHaveLength(3);
      expect(page(response.body).nextCursor).toBeNull();
    });

    it('never exposes how many units are held in other carts', async () => {
      const response = await request(server()).get('/products').expect(200);

      // `reserved` is internal: it tells the buyer nothing and leaks how the
      // store is selling. Returning the entity directly would have published it.
      expect(page(response.body).items[0]).not.toHaveProperty('reserved');
      expect(page(response.body).items[0]).not.toHaveProperty('version');
    });

    it('returns a signed image URL instead of the storage key', async () => {
      const response = await request(server()).get('/products').expect(200);

      // The bucket is private: a bare key would be a broken image.
      expect(page(response.body).items[0]?.imageUrl).toBe(
        'https://cdn.test/product/cafetera.webp?signed',
      );
      expect(page(response.body).items[0]).not.toHaveProperty('imageKey');
    });

    it('returns the price as integer minor units', async () => {
      const response = await request(server()).get('/products').expect(200);

      expect(page(response.body).items[0]?.priceInCents).toBe(150_000);
      expect(Number.isInteger(page(response.body).items[0]?.priceInCents)).toBe(true);
    });

    it('marks a sold out product as not purchasable', async () => {
      const response = await request(server()).get('/products').expect(200);
      const soldOut = page(response.body).items.find((item) => item.id === 'prod-03');

      expect(soldOut?.availableUnits).toBe(0);
      expect(soldOut?.isPurchasable).toBe(false);
    });

    it('honours the page size and hands back a cursor', async () => {
      const response = await request(server()).get('/products?limit=2').expect(200);

      expect(page(response.body).items).toHaveLength(2);
      expect(page(response.body).nextCursor).not.toBeNull();
    });

    it('rejects a limit above the cap with 422 rather than silently changing it', async () => {
      const response = await request(server()).get('/products?limit=999').expect(422);

      expect(failure(response.body).error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a non-numeric limit', async () => {
      await request(server()).get('/products?limit=many').expect(422);
    });

    it('rejects an unknown query parameter instead of ignoring it', async () => {
      // forbidNonWhitelisted is what stops a client smuggling extra fields
      // into a payload; the same setting applies here.
      await request(server()).get('/products?isAdmin=true').expect(422);
    });

    it('allows the response to be cached briefly', async () => {
      const response = await request(server()).get('/products').expect(200);

      expect(response.headers['cache-control']).toContain('max-age=10');
    });
  });

  describe('GET /products/:id', () => {
    it('answers 200 with the product', async () => {
      const response = await request(server()).get('/products/prod-01').expect(200);

      expect(product(response.body).id).toBe('prod-01');
      expect(product(response.body).availableUnits).toBe(10);
    });

    it('answers 404 with the shared error envelope', async () => {
      const response = await request(server()).get('/products/does-not-exist').expect(404);

      expect(failure(response.body).error.code).toBe('PRODUCT_NOT_FOUND');
      expect(response.body).toHaveProperty('requestId');
    });

    it('does not leak internal detail in the not-found response', async () => {
      const response = await request(server()).get('/products/does-not-exist').expect(404);

      expect(JSON.stringify(response.body)).not.toMatch(/dynamo|table|PK|SK/i);
    });
  });
});
