import { createHash } from 'node:crypto';

import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { type ClockPort, ResultAsync } from '../../../../shared/domain';
import { CheckoutUnavailable } from '../../domain/checkout.errors';
import { Customer, type CustomerDetails } from '../../domain/customer';
import type { CustomerRepository } from '../../domain/customer.repository';

/**
 * Single-table layout for a customer.
 *
 *   PK  CUSTOMER#<sha256 of the email>     SK  #PROFILE
 *
 * Keyed by a hash of the email so that "is this buyer already known" is a key
 * lookup, and so the address itself never appears in a key — keys end up in
 * logs, metrics and error messages far more often than attribute values do.
 */
interface CustomerItem {
  id: string;
  fullName: string;
  email: string;
  phone: string;
}

export const customerKey = (email: string): string =>
  `CUSTOMER#${createHash('sha256').update(email).digest('hex')}`;

export class DynamoCustomerRepository implements CustomerRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly clock: ClockPort,
  ) {}

  register(details: CustomerDetails, newId: string): ResultAsync<Customer, CheckoutUnavailable> {
    const now = this.clock.now().toISOString();

    return ResultAsync.fromPromise(
      this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: customerKey(details.email), SK: '#PROFILE' },
          // if_not_exists keeps the id and creation date of a returning buyer,
          // while name and phone take whatever they typed this time.
          UpdateExpression:
            'SET #id = if_not_exists(#id, :id), #createdAt = if_not_exists(#createdAt, :now), ' +
            '#fullName = :fullName, #email = :email, #phone = :phone, #updatedAt = :now',
          ExpressionAttributeNames: {
            '#id': 'id',
            '#createdAt': 'createdAt',
            '#updatedAt': 'updatedAt',
            '#fullName': 'fullName',
            '#email': 'email',
            '#phone': 'phone',
          },
          ExpressionAttributeValues: {
            ':id': newId,
            ':now': now,
            ':fullName': details.fullName,
            ':email': details.email,
            ':phone': details.phone,
          },
          ReturnValues: 'ALL_NEW',
        }),
      ),
      (cause) => new CheckoutUnavailable('Could not record the customer', cause),
    ).map((response) => Customer.restore(response.Attributes as CustomerItem));
  }
}
