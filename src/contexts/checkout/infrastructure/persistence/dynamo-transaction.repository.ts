import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { ResultAsync, err, type Result } from '../../../../shared/domain';
import {
  CheckoutUnavailable,
  TransactionNotFound,
  TransactionNotPayable,
} from '../../domain/checkout.errors';
import { Customer } from '../../domain/customer';
import { DeliveryAddress } from '../../domain/delivery-address';
import { Quote } from '../../domain/quote';
import { Transaction, type TransactionStatus } from '../../domain/transaction';
import type { TransactionRepository } from '../../domain/transaction.repository';

/**
 * Single-table layout for a transaction.
 *
 *   PK      TRANSACTION#<id>      SK  #META
 *   GSI1PK  PENDING_TRANSACTION   GSI1SK  <reservation deadline, ISO 8601>
 *
 * The GSI1 keys are present only while the transaction is PENDING, which makes
 * GSI1 a sparse index of open reservations ordered by deadline. Finding the
 * expired ones is then a Query for "deadline before now" that reads only
 * pending rows, instead of a Scan over every order ever placed.
 *
 * The deadline is stored as `reservationExpiresAt`, never `expiresAt`: the
 * table's TTL is configured on `expiresAt`, and DynamoDB would delete the
 * transaction itself once that moment passed.
 *
 * The customer and address are copied into the transaction rather than
 * referenced. An order records who bought and where it goes at the time of
 * purchase; a buyer changing their phone next month must not rewrite it.
 */
export interface TransactionItem {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  id: string;
  status: TransactionStatus;
  productId: string;
  productName: string;
  unitPriceInCents: number;
  units: number;
  productInCents: number;
  baseFeeInCents: number;
  deliveryFeeInCents: number;
  totalInCents: number;
  currency: string;
  customerId: string;
  customerFullName: string;
  customerEmail: string;
  customerPhone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region: string;
  postalCode?: string;
  country: string;
  createdAt: string;
  updatedAt: string;
  reservationExpiresAt: string;
  paymentClaimedAt?: string;
  gatewayTransactionId?: string;
  version: number;
}

export const PENDING_PARTITION = 'PENDING_TRANSACTION';
const key = (id: string): { PK: string; SK: string } => ({ PK: `TRANSACTION#${id}`, SK: '#META' });

export class DynamoTransactionRepository implements TransactionRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  create(transaction: Transaction): ResultAsync<Transaction, CheckoutUnavailable> {
    return ResultAsync.fromPromise(
      this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: toItem(transaction),
          // Ids are random, so a collision means a defect, not bad luck. Failing
          // is correct; overwriting someone else's order is not.
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      ),
      (cause) => new CheckoutUnavailable('Could not record the transaction', cause),
    ).map(() => transaction);
  }

  findById(id: string): ResultAsync<Transaction, TransactionNotFound | CheckoutUnavailable> {
    return ResultAsync.fromPromise(
      this.client.send(
        new GetCommand({ TableName: this.tableName, Key: key(id), ConsistentRead: true }),
      ),
      (cause) => new CheckoutUnavailable('Could not read the transaction', cause),
    ).andThen((response): Result<Transaction, TransactionNotFound | CheckoutUnavailable> => {
      if (response.Item === undefined) {
        return err(new TransactionNotFound(id));
      }

      return toDomain(response.Item as TransactionItem);
    });
  }

  claimPayment(
    transaction: Transaction,
  ): ResultAsync<Transaction, TransactionNotPayable | CheckoutUnavailable> {
    return ResultAsync.fromPromise(
      this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: key(transaction.id),
          UpdateExpression:
            'SET #paymentClaimedAt = :claimedAt, #updatedAt = :updatedAt, #version = :version',
          // Evaluated by DynamoDB while it holds the item: of two concurrent
          // claims, exactly one satisfies this.
          ConditionExpression:
            'attribute_exists(PK) AND #status = :pending AND attribute_not_exists(#paymentClaimedAt)',
          ExpressionAttributeNames: {
            '#paymentClaimedAt': 'paymentClaimedAt',
            '#updatedAt': 'updatedAt',
            '#version': 'version',
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':claimedAt': transaction.paymentClaimedAt?.toISOString(),
            ':updatedAt': transaction.updatedAt.toISOString(),
            ':version': transaction.version,
            ':pending': 'PENDING',
          },
        }),
      ),
      (cause): TransactionNotPayable | CheckoutUnavailable =>
        cause instanceof ConditionalCheckFailedException
          ? new TransactionNotPayable(transaction.id, 'ALREADY_SUBMITTED')
          : new CheckoutUnavailable('Could not claim the payment', cause),
    ).map(() => transaction);
  }

  /**
   * Replaces the stored transaction, guarded by its version.
   *
   * The condition is the optimistic lock: if anything else wrote the row since
   * this copy was read, the write is refused rather than silently undoing it.
   */
  update(transaction: Transaction): ResultAsync<Transaction, CheckoutUnavailable> {
    return ResultAsync.fromPromise(
      this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: toItem(transaction),
          ConditionExpression: '#version = :previous',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: { ':previous': transaction.version - 1 },
        }),
      ),
      (cause) =>
        new CheckoutUnavailable(
          cause instanceof ConditionalCheckFailedException
            ? 'The transaction changed while it was being updated'
            : 'Could not update the transaction',
          cause,
        ),
    ).map(() => transaction);
  }
}

export const toItem = (transaction: Transaction): TransactionItem => {
  const { quote, customer, deliveryAddress: address } = transaction;

  return {
    ...key(transaction.id),
    ...(transaction.isFinal
      ? {}
      : {
          GSI1PK: PENDING_PARTITION,
          GSI1SK: transaction.reservationExpiresAt.toISOString(),
        }),
    id: transaction.id,
    status: transaction.status,
    productId: transaction.product.id,
    productName: transaction.product.name,
    unitPriceInCents: quote.unitPriceInCents,
    units: quote.units,
    productInCents: quote.productInCents,
    baseFeeInCents: quote.baseFeeInCents,
    deliveryFeeInCents: quote.deliveryFeeInCents,
    totalInCents: quote.totalInCents,
    currency: quote.currency,
    customerId: customer.id,
    customerFullName: customer.fullName,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    addressLine1: address.addressLine1,
    ...(address.addressLine2 === undefined ? {} : { addressLine2: address.addressLine2 }),
    city: address.city,
    region: address.region,
    ...(address.postalCode === undefined ? {} : { postalCode: address.postalCode }),
    country: address.country,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
    reservationExpiresAt: transaction.reservationExpiresAt.toISOString(),
    ...(transaction.paymentClaimedAt === undefined
      ? {}
      : { paymentClaimedAt: transaction.paymentClaimedAt.toISOString() }),
    ...(transaction.gatewayTransactionId === undefined
      ? {}
      : { gatewayTransactionId: transaction.gatewayTransactionId }),
    version: transaction.version,
  };
};

export const toDomain = (item: TransactionItem): Result<Transaction, CheckoutUnavailable> =>
  DeliveryAddress.create(item)
    .mapErr((cause) => new CheckoutUnavailable('Stored transaction is malformed', cause))
    .map((deliveryAddress) =>
      Transaction.restore({
        id: item.id,
        status: item.status,
        product: { id: item.productId, name: item.productName },
        quote: Quote.restore(item),
        customer: Customer.restore({
          id: item.customerId,
          fullName: item.customerFullName,
          email: item.customerEmail,
          phone: item.customerPhone,
        }),
        deliveryAddress,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        reservationExpiresAt: new Date(item.reservationExpiresAt),
        paymentClaimedAt:
          item.paymentClaimedAt === undefined ? undefined : new Date(item.paymentClaimedAt),
        gatewayTransactionId: item.gatewayTransactionId,
        version: item.version,
      }),
    );
