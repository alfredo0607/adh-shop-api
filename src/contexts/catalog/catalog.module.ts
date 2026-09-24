import { Module } from '@nestjs/common';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { ENVIRONMENT, type Environment } from '../../shared/infrastructure/config/environment';
import {
  DYNAMODB_CLIENT,
  createDynamoDbClient,
} from '../../shared/infrastructure/persistence/dynamodb.provider';
import { FindProduct } from './application/find-product.usecase';
import { ListProducts } from './application/list-products.usecase';
import { PRODUCT_REPOSITORY, type ProductRepository } from './domain/product.repository';
import { ProductController } from './infrastructure/http/product.controller';
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
      provide: FindProduct,
      inject: [PRODUCT_REPOSITORY],
      useFactory: (products: ProductRepository): FindProduct => new FindProduct(products),
    },
  ],
  exports: [PRODUCT_REPOSITORY],
})
export class CatalogModule {}
