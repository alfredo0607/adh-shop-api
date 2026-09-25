import { Module } from '@nestjs/common';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { CLOCK_PORT, type ClockPort } from '../../shared/domain/clock.port';
import { ID_GENERATOR_PORT, type IdGeneratorPort } from '../../shared/domain/id-generator.port';
import { ENVIRONMENT, type Environment } from '../../shared/infrastructure/config/environment';
import { DYNAMODB_CLIENT } from '../../shared/infrastructure/persistence/dynamodb.provider';
import { CatalogModule } from '../catalog/catalog.module';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../catalog/domain/product.repository';
import { type CheckoutPolicy, CreateTransaction } from './application/create-transaction.usecase';
import { FindTransaction } from './application/find-transaction.usecase';
import { QuoteCheckout } from './application/quote-checkout.usecase';
import { CUSTOMER_REPOSITORY, type CustomerRepository } from './domain/customer.repository';
import { INVENTORY_PORT, type InventoryPort } from './domain/inventory.port';
import {
  TRANSACTION_REPOSITORY,
  type TransactionRepository,
} from './domain/transaction.repository';
import { TransactionController } from './infrastructure/http/transaction.controller';
import { CatalogInventoryAdapter } from './infrastructure/inventory/catalog-inventory.adapter';
import { DynamoCustomerRepository } from './infrastructure/persistence/dynamo-customer.repository';
import { DynamoTransactionRepository } from './infrastructure/persistence/dynamo-transaction.repository';

const CHECKOUT_POLICY = Symbol('CheckoutPolicy');

/**
 * Wires the checkout. Use cases are built by hand for the reason given in the
 * catalogue module: they stay plain classes, testable without a container.
 */
@Module({
  imports: [CatalogModule],
  controllers: [TransactionController],
  providers: [
    {
      provide: CHECKOUT_POLICY,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): CheckoutPolicy => ({
        fees: {
          baseFeeInCents: environment.BASE_FEE_IN_CENTS,
          deliveryFeeInCents: environment.DELIVERY_FEE_IN_CENTS,
        },
        reservationTtlMs: environment.RESERVATION_TTL_MINUTES * 60_000,
      }),
    },
    {
      provide: INVENTORY_PORT,
      inject: [PRODUCT_REPOSITORY],
      useFactory: (products: ProductRepository): InventoryPort =>
        new CatalogInventoryAdapter(products),
    },
    {
      provide: CUSTOMER_REPOSITORY,
      inject: [DYNAMODB_CLIENT, ENVIRONMENT, CLOCK_PORT],
      useFactory: (
        client: DynamoDBDocumentClient,
        environment: Environment,
        clock: ClockPort,
      ): CustomerRepository =>
        new DynamoCustomerRepository(client, environment.DYNAMODB_TABLE_NAME, clock),
    },
    {
      provide: TRANSACTION_REPOSITORY,
      inject: [DYNAMODB_CLIENT, ENVIRONMENT],
      useFactory: (
        client: DynamoDBDocumentClient,
        environment: Environment,
      ): TransactionRepository =>
        new DynamoTransactionRepository(client, environment.DYNAMODB_TABLE_NAME),
    },
    {
      provide: QuoteCheckout,
      inject: [INVENTORY_PORT, CHECKOUT_POLICY],
      useFactory: (inventory: InventoryPort, policy: CheckoutPolicy): QuoteCheckout =>
        new QuoteCheckout(inventory, policy.fees),
    },
    {
      provide: CreateTransaction,
      inject: [
        INVENTORY_PORT,
        CUSTOMER_REPOSITORY,
        TRANSACTION_REPOSITORY,
        ID_GENERATOR_PORT,
        CLOCK_PORT,
        CHECKOUT_POLICY,
      ],
      useFactory: (
        inventory: InventoryPort,
        customers: CustomerRepository,
        transactions: TransactionRepository,
        ids: IdGeneratorPort,
        clock: ClockPort,
        policy: CheckoutPolicy,
      ): CreateTransaction =>
        new CreateTransaction(inventory, customers, transactions, ids, clock, policy),
    },
    {
      provide: FindTransaction,
      inject: [TRANSACTION_REPOSITORY],
      useFactory: (transactions: TransactionRepository): FindTransaction =>
        new FindTransaction(transactions),
    },
  ],
  exports: [TRANSACTION_REPOSITORY, INVENTORY_PORT],
})
export class CheckoutModule {}
