import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { ResultAsync, err, type Result } from '../../../../shared/domain';
import { CheckoutUnavailable, DeliveryNotFound } from '../../domain/checkout.errors';
import { Delivery, type DeliveryStatus } from '../../domain/delivery';
import { DeliveryAddress } from '../../domain/delivery-address';
import type { DeliveryRepository } from '../../domain/transaction.repository';
import { type DeliveryItem, deliveryKey } from './dynamo-transaction.repository';

/** Deliveries are written by the settlement; this adapter only reads them. */
export class DynamoDeliveryRepository implements DeliveryRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  findByTransactionId(
    transactionId: string,
  ): ResultAsync<Delivery, DeliveryNotFound | CheckoutUnavailable> {
    return ResultAsync.fromPromise(
      this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: deliveryKey(transactionId),
          ConsistentRead: true,
        }),
      ),
      (cause) => new CheckoutUnavailable('Could not read the delivery', cause),
    ).andThen((response): Result<Delivery, DeliveryNotFound | CheckoutUnavailable> => {
      if (response.Item === undefined) {
        return err(new DeliveryNotFound(transactionId));
      }

      const item = response.Item as DeliveryItem;
      const items =
        item.items?.map((line) => ({
          productId: line.productId,
          name: line.productName,
          units: line.units,
        })) ??
        (item.productId === undefined
          ? []
          : [{ productId: item.productId, name: item.productName ?? '', units: item.units ?? 0 }]);

      return DeliveryAddress.create(item)
        .mapErr((cause) => new CheckoutUnavailable('Stored delivery is malformed', cause))
        .map((address) =>
          Delivery.restore({
            transactionId: item.transactionId,
            status: item.status as DeliveryStatus,
            items,
            recipientName: item.recipientName,
            recipientPhone: item.recipientPhone,
            address,
            createdAt: new Date(item.createdAt),
            estimatedDeliveryAt: new Date(item.estimatedDeliveryAt),
          }),
        );
    });
  }
}
