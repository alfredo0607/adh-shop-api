import { Module } from '@nestjs/common';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { CLOCK_PORT, type ClockPort } from '../../shared/domain/clock.port';
import { ID_GENERATOR_PORT, type IdGeneratorPort } from '../../shared/domain/id-generator.port';
import { ENVIRONMENT, type Environment } from '../../shared/infrastructure/config/environment';
import { DYNAMODB_CLIENT } from '../../shared/infrastructure/persistence/dynamodb.provider';
import { CatalogModule } from '../catalog/catalog.module';
import { PRODUCT_REPOSITORY, type ProductRepository } from '../catalog/domain/product.repository';
import { type CheckoutPolicy, CreateTransaction } from './application/create-transaction.usecase';
import { ExpireReservations } from './application/expire-reservations.usecase';
import { FindDelivery, FindTransaction } from './application/find-transaction.usecase';
import { GetPaymentTerms } from './application/get-payment-terms.usecase';
import { PayTransaction } from './application/pay-transaction.usecase';
import { QuoteCheckout } from './application/quote-checkout.usecase';
import { SettleTransaction } from './application/settle-transaction.usecase';
import { CUSTOMER_REPOSITORY, type CustomerRepository } from './domain/customer.repository';
import { INVENTORY_PORT, type InventoryPort } from './domain/inventory.port';
import { PAYMENT_GATEWAY_PORT, type PaymentGatewayPort } from './domain/payment-gateway.port';
import {
  DELIVERY_REPOSITORY,
  type DeliveryRepository,
  TRANSACTION_REPOSITORY,
  type TransactionRepository,
} from './domain/transaction.repository';
import { PaymentController } from './infrastructure/http/payment.controller';
import {
  PAYMENT_EVENT_VERIFIER,
  PaymentEventsController,
} from './infrastructure/http/payment-events.controller';
import { TransactionController } from './infrastructure/http/transaction.controller';
import { CatalogInventoryAdapter } from './infrastructure/inventory/catalog-inventory.adapter';
import { HttpPaymentGateway } from './infrastructure/payment/http-payment.gateway';
import { PaymentEventVerifier } from './infrastructure/payment/payment-event.verifier';
import { DynamoCustomerRepository } from './infrastructure/persistence/dynamo-customer.repository';
import { DynamoDeliveryRepository } from './infrastructure/persistence/dynamo-delivery.repository';
import {
  ReservationSweeper,
  SWEEP_INTERVAL_MS,
} from './infrastructure/scheduling/reservation-sweeper';
import { DynamoTransactionRepository } from './infrastructure/persistence/dynamo-transaction.repository';

const CHECKOUT_POLICY = Symbol('CheckoutPolicy');

/**
 * Wires the checkout. Use cases are built by hand for the reason given in the
 * catalogue module: they stay plain classes, testable without a container.
 */
@Module({
  imports: [CatalogModule],
  controllers: [TransactionController, PaymentController, PaymentEventsController],
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
      provide: PAYMENT_GATEWAY_PORT,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): PaymentGatewayPort =>
        new HttpPaymentGateway({
          baseUrl: environment.PAYMENT_API_URL.replace(/\/+$/, ''),
          publicKey: environment.PAYMENT_PUBLIC_KEY,
          privateKey: environment.PAYMENT_PRIVATE_KEY,
          integritySecret: environment.PAYMENT_INTEGRITY_SECRET,
          timeoutMs: environment.PAYMENT_TIMEOUT_MS,
        }),
    },
    {
      provide: GetPaymentTerms,
      inject: [PAYMENT_GATEWAY_PORT],
      useFactory: (gateway: PaymentGatewayPort): GetPaymentTerms => new GetPaymentTerms(gateway),
    },
    {
      provide: PayTransaction,
      inject: [TRANSACTION_REPOSITORY, PAYMENT_GATEWAY_PORT, CLOCK_PORT],
      useFactory: (
        transactions: TransactionRepository,
        gateway: PaymentGatewayPort,
        clock: ClockPort,
      ): PayTransaction => new PayTransaction(transactions, gateway, clock),
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
      provide: DELIVERY_REPOSITORY,
      inject: [DYNAMODB_CLIENT, ENVIRONMENT],
      useFactory: (client: DynamoDBDocumentClient, environment: Environment): DeliveryRepository =>
        new DynamoDeliveryRepository(client, environment.DYNAMODB_TABLE_NAME),
    },
    {
      provide: SettleTransaction,
      inject: [TRANSACTION_REPOSITORY, CLOCK_PORT],
      useFactory: (transactions: TransactionRepository, clock: ClockPort): SettleTransaction =>
        new SettleTransaction(transactions, clock),
    },
    {
      provide: FindTransaction,
      inject: [TRANSACTION_REPOSITORY, PAYMENT_GATEWAY_PORT, SettleTransaction],
      useFactory: (
        transactions: TransactionRepository,
        gateway: PaymentGatewayPort,
        settle: SettleTransaction,
      ): FindTransaction => new FindTransaction(transactions, gateway, settle),
    },
    {
      provide: FindDelivery,
      inject: [DELIVERY_REPOSITORY],
      useFactory: (deliveries: DeliveryRepository): FindDelivery => new FindDelivery(deliveries),
    },
    {
      provide: ExpireReservations,
      inject: [TRANSACTION_REPOSITORY, PAYMENT_GATEWAY_PORT, SettleTransaction, CLOCK_PORT],
      useFactory: (
        transactions: TransactionRepository,
        gateway: PaymentGatewayPort,
        settle: SettleTransaction,
        clock: ClockPort,
      ): ExpireReservations => new ExpireReservations(transactions, gateway, settle, clock),
    },
    {
      provide: SWEEP_INTERVAL_MS,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): number =>
        environment.RESERVATION_SWEEP_INTERVAL_SECONDS * 1000,
    },
    ReservationSweeper,
    {
      provide: PAYMENT_EVENT_VERIFIER,
      inject: [ENVIRONMENT, CLOCK_PORT],
      useFactory: (environment: Environment, clock: ClockPort): PaymentEventVerifier =>
        new PaymentEventVerifier(environment.PAYMENT_EVENTS_SECRET, () => clock.now()),
    },
  ],
  exports: [TRANSACTION_REPOSITORY, INVENTORY_PORT, PAYMENT_GATEWAY_PORT],
})
export class CheckoutModule {}
