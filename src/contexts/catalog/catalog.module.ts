import { Module } from '@nestjs/common';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { CLOCK_PORT, type ClockPort } from '../../shared/domain/clock.port';
import { ENVIRONMENT, type Environment } from '../../shared/infrastructure/config/environment';
import {
  DYNAMODB_CLIENT,
  createDynamoDbClient,
} from '../../shared/infrastructure/persistence/dynamodb.provider';
import { FindProduct } from './application/find-product.usecase';
import { IMAGE_URL_SIGNER, type ImageUrlSigner } from './application/image-url-signer.port';
import { ListProducts } from './application/list-products.usecase';
import { PRODUCT_REPOSITORY, type ProductRepository } from './domain/product.repository';
import { ProductController } from './infrastructure/http/product.controller';
import {
  CloudFrontImageUrlSigner,
  UnsignedImageUrlSigner,
} from './infrastructure/images/cloudfront-image-url.signer';
import { DynamoProductRepository } from './infrastructure/persistence/dynamo-product.repository';

/**
 * Binds the catalogue's port to its adapter and builds the use cases.
 *
 * The use cases are plain classes with no decorators, so they are constructed
 * here by hand. That is deliberate: a use case that carries `@Injectable()` can
 * only be instantiated through a DI container, which makes testing it require
 * one. Keeping the framework at the edge is what lets every use case test be a
 * constructor call with an in-memory repository.
 */
@Module({
  controllers: [ProductController],
  providers: [
    {
      provide: DYNAMODB_CLIENT,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): DynamoDBDocumentClient =>
        createDynamoDbClient(environment),
    },
    {
      provide: PRODUCT_REPOSITORY,
      inject: [DYNAMODB_CLIENT, ENVIRONMENT],
      useFactory: (client: DynamoDBDocumentClient, environment: Environment): ProductRepository =>
        new DynamoProductRepository(client, environment.DYNAMODB_TABLE_NAME),
    },
    {
      provide: ListProducts,
      inject: [PRODUCT_REPOSITORY],
      useFactory: (products: ProductRepository): ListProducts => new ListProducts(products),
    },
    {
      provide: IMAGE_URL_SIGNER,
      inject: [ENVIRONMENT, CLOCK_PORT],
      useFactory: (environment: Environment, clock: ClockPort): ImageUrlSigner => {
        const { CDN_DOMAIN, CDN_KEY_PAIR_ID, CDN_PRIVATE_KEY_BASE64 } = environment;

        if (!CDN_DOMAIN || !CDN_KEY_PAIR_ID || !CDN_PRIVATE_KEY_BASE64) {
          return new UnsignedImageUrlSigner();
        }

        return new CloudFrontImageUrlSigner(
          {
            domain: CDN_DOMAIN,
            keyPairId: CDN_KEY_PAIR_ID,
            privateKey: Buffer.from(CDN_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
            ttlSeconds: environment.IMAGE_URL_TTL_SECONDS,
          },
          clock,
        );
      },
    },
    {
      provide: FindProduct,
      inject: [PRODUCT_REPOSITORY],
      useFactory: (products: ProductRepository): FindProduct => new FindProduct(products),
    },
  ],
  exports: [PRODUCT_REPOSITORY],
})
export class CatalogModule {}
