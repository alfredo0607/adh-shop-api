/**
 * Seeds the catalogue.
 *
 * The brief requires the store to start with dummy products and says there is
 * no need for an endpoint that creates them, so this script is the only way
 * inventory enters the system.
 *
 *   pnpm seed
 *
 * Idempotent: re-running restores the seeded stock levels, which is what makes
 * it usable to reset a demo after buying things.
 */
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

import { PRODUCT_SEED } from '../src/contexts/catalog/infrastructure/seed/products.seed';
import { parseEnvironment } from '../src/shared/infrastructure/config/environment';
import { createDynamoDbClient } from '../src/shared/infrastructure/persistence/dynamodb.provider';

const BATCH_SIZE = 25;

const main = async (): Promise<void> => {
  const environment = parseEnvironment(process.env);
  const client = createDynamoDbClient(environment);

  const items = PRODUCT_SEED.map((product) => ({
    PutRequest: {
      Item: {
        PK: `PRODUCT#${product.id}`,
        SK: '#META',
        // The constant partition is what makes listing a Query instead of a
        // Scan over the whole single table.
        GSI1PK: 'PRODUCT',
        GSI1SK: product.id,
        ...product,
        reserved: 0,
        version: 0,
      },
    },
  }));

  // BatchWrite accepts 25 items per request.
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    const response = await client.send(
      new BatchWriteCommand({ RequestItems: { [environment.DYNAMODB_TABLE_NAME]: batch } }),
    );

    // BatchWrite can partially succeed and report the rest as unprocessed
    // rather than failing. Ignoring that field silently loses products.
    const unprocessed = response.UnprocessedItems?.[environment.DYNAMODB_TABLE_NAME] ?? [];
    if (unprocessed.length > 0) {
      throw new Error(`${unprocessed.length} items were not written; re-run the seed`);
    }
  }

  process.stdout.write(
    `Seeded ${PRODUCT_SEED.length} products into ${environment.DYNAMODB_TABLE_NAME}\n`,
  );
};

main().catch((error: Error) => {
  process.stderr.write(`Seed failed: ${error.message}\n`);
  process.exitCode = 1;
});
