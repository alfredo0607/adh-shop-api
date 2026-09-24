import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import type { Environment } from '../config/environment';

export const DYNAMODB_CLIENT = Symbol('DynamoDbClient');
export const DYNAMODB_TABLE = Symbol('DynamoDbTable');

/**
 * Builds the DynamoDB document client.
 *
 * The document client is used rather than the low-level one so attribute values
 * are plain JavaScript rather than `{ S: "..." }` wrappers. That is most of the
 * boilerplate an ORM would remove, and it comes from the SDK itself.
 *
 * `DYNAMODB_ENDPOINT` is set only against DynamoDB Local. In a deployed
 * environment it is absent and the SDK resolves the real endpoint, reached
 * through the VPC gateway endpoint rather than the internet.
 */
export const createDynamoDbClient = (environment: Environment): DynamoDBDocumentClient => {
  const client = new DynamoDBClient({
    region: environment.AWS_REGION,
    ...(environment.DYNAMODB_ENDPOINT === undefined
      ? {}
      : {
          endpoint: environment.DYNAMODB_ENDPOINT,
          // DynamoDB Local accepts anything, but the SDK still requires
          // credentials to be present before it will sign a request.
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }),
    maxAttempts: 3,
  });

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      // An attribute set to undefined is an absent attribute, not an error.
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
    unmarshallOptions: {
      // Numbers stay as numbers. Money is already integer cents, so there is
      // nothing here that would lose precision.
      wrapNumbers: false,
    },
  });
};
