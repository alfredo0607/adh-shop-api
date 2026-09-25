import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { ResultAsync, err, type Result } from '../../../../shared/domain';
import { productKey } from '../../../catalog/infrastructure/persistence/dynamo-product.repository';
import {
  CheckoutUnavailable,
  SettlementConflict,
  TransactionNotFound,
  TransactionNotPayable,
} from '../../domain/checkout.errors';
import type { Delivery } from '../../domain/delivery';
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

/**
 * Stored under the transaction's partition, so a transaction and its delivery
 * are one Query apart and never need a second index.
 *
 *   PK  TRANSACTION#<id>     SK  #DELIVERY
 */
export const deliveryKey = (transactionId: string): { PK: string; SK: string } => ({
  PK: `TRANSACTION#${transactionId}`,
  SK: '#DELIVERY',
});

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
  saveSettlement(
    settled: Transaction,
    delivery: Delivery | undefined,
  ): ResultAsync<Transaction, SettlementConflict | CheckoutUnavailable> {
    const units = settled.quote.units;

    const stock =
      settled.status === 'APPROVED'
        ? // Sold: the units leave the product for good.
          'SET #reserved = #reserved - :units, #version = #version + :one'
        : // Not sold: the units go back on the shelf.
          'SET #available = #available + :units, #reserved = #reserved - :units, #version = #version + :one';

    return ResultAsync.fromPromise(
      this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: toItem(settled),
                // Only from PENDING, and only if nothing else wrote since this
                // copy was read. The event and the poll can race; one wins.
                ConditionExpression: '#status = :pending AND #version = :previous',
                ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
                ExpressionAttributeValues: {
                  ':pending': 'PENDING',
                  ':previous': settled.version - 1,
                },
              },
            },
            {
              Update: {
                TableName: this.tableName,
                Key: productKey(settled.product.id),
                UpdateExpression: stock,
                ConditionExpression: '#reserved >= :units',
                ExpressionAttributeNames: {
                  '#reserved': 'reserved',
                  '#version': 'version',
                  ...(settled.status === 'APPROVED' ? {} : { '#available': 'available' }),
                },
                ExpressionAttributeValues: { ':units': units, ':one': 1 },
              },
            },
            ...(delivery === undefined
              ? []
              : [
                  {
                    Put: {
                      TableName: this.tableName,
                      Item: toDeliveryItem(delivery),
                      ConditionExpression: 'attribute_not_exists(PK)',
                    },
                  },
                ]),
          ],
        }),
      ),
      (cause): SettlementConflict | CheckoutUnavailable =>
        isTransactionConflict(cause)
          ? new SettlementConflict(settled.id, cause)
          : new CheckoutUnavailable('Could not settle the transaction', cause),
    ).map(() => settled);
  }

  /**
   * Reads the sparse index of open reservations, which holds only PENDING
   * transactions and is sorted by deadline: "expired" is a range condition on
   * the sort key, and nothing already settled is ever read.
   *
   * Index reads are eventually consistent. A row that settled a moment ago can
   * still appear here; the settlement's conditional write is what makes acting
   * on it safe.
   */
  findExpiredReservations(
    now: Date,
    limit: number,
    after?: Transaction,
  ): ResultAsync<Transaction[], CheckoutUnavailable> {
    return ResultAsync.fromPromise(
      this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pending AND GSI1SK < :now',
          ExpressionAttributeValues: {
            ':pending': PENDING_PARTITION,
            ':now': now.toISOString(),
          },
          Limit: limit,
          // The index key of the last row already read, rebuilt from the row
          // itself: the same four attributes DynamoDB would hand back.
          ...(after === undefined
            ? {}
            : {
                ExclusiveStartKey: {
                  ...key(after.id),
                  GSI1PK: PENDING_PARTITION,
                  GSI1SK: after.reservationExpiresAt.toISOString(),
                },
              }),
        }),
      ),
      (cause) => new CheckoutUnavailable('Could not read expired reservations', cause),
    ).map((response) =>
      ((response.Items ?? []) as TransactionItem[])
        .map(toDomain)
        // A malformed row is skipped rather than blocking every expiry behind it.
        .flatMap((result) => (result.isOk() ? [result.value] : [])),
    );
  }
}

/**
 * Only a failed condition on the transaction row itself means someone else
 * settled first. A failed condition on the stock row is a real inconsistency
 * and must surface as a failure, not be mistaken for a harmless race.
 */
const isTransactionConflict = (cause: unknown): boolean =>
  cause instanceof TransactionCanceledException &&
  cause.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed';

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

export interface DeliveryItem {
  PK: string;
  SK: string;
  transactionId: string;
  status: string;
  productId: string;
  productName: string;
  units: number;
  recipientName: string;
  recipientPhone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region: string;
  postalCode?: string;
  country: string;
  createdAt: string;
  estimatedDeliveryAt: string;
}

export const toDeliveryItem = (delivery: Delivery): DeliveryItem => {
  const { address } = delivery;

  return {
    ...deliveryKey(delivery.transactionId),
    transactionId: delivery.transactionId,
    status: delivery.status,
    productId: delivery.productId,
    productName: delivery.productName,
    units: delivery.units,
    recipientName: delivery.recipientName,
    recipientPhone: delivery.recipientPhone,
    addressLine1: address.addressLine1,
    ...(address.addressLine2 === undefined ? {} : { addressLine2: address.addressLine2 }),
    city: address.city,
    region: address.region,
    ...(address.postalCode === undefined ? {} : { postalCode: address.postalCode }),
    country: address.country,
    createdAt: delivery.createdAt.toISOString(),
    estimatedDeliveryAt: delivery.estimatedDeliveryAt.toISOString(),
  };
};
