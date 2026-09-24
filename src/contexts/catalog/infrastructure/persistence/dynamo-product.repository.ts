import {
  ConditionalCheckFailedException,
  type DynamoDBServiceException,
} from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { ResultAsync, err, ok, type Result } from '../../../../shared/domain';
import {
  CatalogUnavailable,
  InsufficientStock,
  ProductNotFound,
  type InvalidProduct,
} from '../../domain/catalog.errors';
import { Money } from '../../domain/money';
import { Product } from '../../domain/product';
import type {
  ProductPage,
  ProductRepository,
  StockTransitionError,
} from '../../domain/product.repository';
import { Stock } from '../../domain/stock';

/**
 * Single-table layout for a product.
 *
 *   PK      PRODUCT#<id>     SK  #META
 *   GSI1PK  PRODUCT          GSI1SK  <id>
 *
 * The constant GSI1PK is what makes "list every product" a Query rather than a
 * Scan. A Scan reads the whole table and is billed for it, and it gets slower
 * as unrelated entities are added — which in a single-table design is
 * guaranteed to happen.
 */
interface ProductItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  name: string;
  description: string;
  priceInCents: number;
  currency: string;
  imageUrl: string;
  available: number;
  reserved: number;
  version: number;
}

const PRODUCT_PARTITION = 'PRODUCT';

export class DynamoProductRepository implements ProductRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  findAll(query: {
    limit: number;
    cursor?: string | undefined;
  }): ResultAsync<ProductPage, CatalogUnavailable> {
    const startKey = this.decodeCursor(query.cursor);

    if (startKey.isErr()) {
      return ResultAsync.fromResult(err(startKey.error));
    }

    return ResultAsync.fromPromise(
      this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :partition',
          ExpressionAttributeValues: { ':partition': PRODUCT_PARTITION },
          Limit: query.limit,
          ExclusiveStartKey: startKey.value,
        }),
      ),
      (cause) => new CatalogUnavailable('Could not read the catalogue', cause),
    ).andThen((response): Result<ProductPage, CatalogUnavailable> => {
      const items = (response.Items ?? []) as ProductItem[];
      const products: Product[] = [];

      for (const item of items) {
        const product = this.toDomain(item);
        // A row that cannot be mapped is a data defect, not a client error.
        // Skipping it keeps the catalogue readable rather than failing the
        // whole page because one record is malformed.
        if (product.isOk()) {
          products.push(product.value);
        }
      }

      return ok({
        items: products,
        nextCursor: this.encodeCursor(response.LastEvaluatedKey),
      });
    });
  }

  findById(id: string): ResultAsync<Product, ProductNotFound | CatalogUnavailable> {
    return ResultAsync.fromPromise(
      this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `${PRODUCT_PARTITION}#${id}`, SK: '#META' },
          // The catalogue must not serve a price that a concurrent write has
          // already changed.
          ConsistentRead: true,
        }),
      ),
      (cause) => new CatalogUnavailable('Could not read the product', cause),
    ).andThen((response): Result<Product, ProductNotFound | CatalogUnavailable> => {
      if (response.Item === undefined) {
        return err(new ProductNotFound(id));
      }

      return this.toDomain(response.Item as ProductItem).mapErr(
        (cause) => new CatalogUnavailable('Stored product is malformed', cause),
      );
    });
  }

  /**
   * Moves units from available to reserved in one conditional write.
   *
   * This is the operation the whole design exists for. Two buyers reaching for
   * the last unit both read `available: 1`, and in a read-modify-write both
   * would pass the check in memory and both would write back a successful
   * reservation — overselling, silently, with nothing in the logs.
   *
   * `ConditionExpression: available >= :units` is evaluated by DynamoDB while
   * it holds the item, so exactly one of the two writes succeeds and the other
   * is rejected. The condition and the update are the same request; there is no
   * window between them for anything to interleave.
   */
  reserveUnits(productId: string, units: number): ResultAsync<Product, StockTransitionError> {
    return this.transition(productId, units, {
      update:
        'SET #available = #available - :units, #reserved = #reserved + :units, #version = #version + :one',
      condition: 'attribute_exists(PK) AND #available >= :units',
      shortfall: 'available',
    });
  }

  /** Turns a reservation into a sale: the units leave the product. */
  confirmUnits(productId: string, units: number): ResultAsync<Product, StockTransitionError> {
    return this.transition(productId, units, {
      update: 'SET #reserved = #reserved - :units, #version = #version + :one',
      condition: 'attribute_exists(PK) AND #reserved >= :units',
      shortfall: 'reserved',
    });
  }

  /** Returns held units to the shelf after a declined or abandoned payment. */
  releaseUnits(productId: string, units: number): ResultAsync<Product, StockTransitionError> {
    return this.transition(productId, units, {
      update:
        'SET #available = #available + :units, #reserved = #reserved - :units, #version = #version + :one',
      condition: 'attribute_exists(PK) AND #reserved >= :units',
      shortfall: 'reserved',
    });
  }

  private transition(
    productId: string,
    units: number,
    expression: { update: string; condition: string; shortfall: 'available' | 'reserved' },
  ): ResultAsync<Product, StockTransitionError> {
    if (!Number.isInteger(units) || units <= 0) {
      return ResultAsync.fromResult<Product, StockTransitionError>(
        err(new InsufficientStock(units, 0)),
      );
    }

    return ResultAsync.fromPromise(
      this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `${PRODUCT_PARTITION}#${productId}`, SK: '#META' },
          UpdateExpression: expression.update,
          ConditionExpression: expression.condition,
          // `available`, `reserved`, `name` and `version` are all reserved
          // words in DynamoDB's expression grammar.
          ExpressionAttributeNames: {
            '#available': 'available',
            '#reserved': 'reserved',
            '#version': 'version',
          },
          ExpressionAttributeValues: { ':units': units, ':one': 1 },
          ReturnValues: 'ALL_NEW',
          // Returns the item alongside the exception when the condition fails.
          // Without it there is no way to tell "no such product" from "not
          // enough units": DynamoDB reports both as the same failure, and every
          // sold-out product would answer 404 instead of 409.
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        }),
      ),
      (cause) => this.explainFailure(cause, productId, units, expression.shortfall),
    ).andThen((response): Result<Product, StockTransitionError> => {
      if (response.Attributes === undefined) {
        return err(new CatalogUnavailable('Update returned no attributes'));
      }

      return this.toDomain(response.Attributes as ProductItem).mapErr(
        (cause) => new CatalogUnavailable('Stored product is malformed', cause),
      );
    });
  }

  /**
   * A failed condition means one of two different things, and the client needs
   * to be able to tell them apart: the product does not exist, or it exists and
   * has too few units. DynamoDB reports both the same way, so the item is read
   * back to decide — only on the failure path, so the happy path stays a single
   * round trip.
   */
  private explainFailure(
    cause: unknown,
    productId: string,
    units: number,
    shortfall: 'available' | 'reserved',
  ): StockTransitionError {
    if (!(cause instanceof ConditionalCheckFailedException)) {
      return new CatalogUnavailable(
        `Could not update stock: ${(cause as DynamoDBServiceException).name ?? 'unknown error'}`,
        cause,
      );
    }

    // ReturnValuesOnConditionCheckFailure gives the item back with the
    // exception, avoiding a second read.
    const item = cause.Item as Record<string, { N?: string }> | undefined;

    if (item === undefined) {
      return new ProductNotFound(productId);
    }

    const held = Number(item[shortfall]?.N ?? 0);
    return new InsufficientStock(units, held);
  }

  private toDomain(item: ProductItem): Result<Product, InvalidProduct | CatalogUnavailable> {
    const price = Money.create(item.priceInCents, item.currency);
    if (price.isErr()) {
      return err(new CatalogUnavailable('Stored price is invalid', price.error));
    }

    const stock = Stock.create(item.available, item.reserved);
    if (stock.isErr()) {
      return err(new CatalogUnavailable('Stored stock is invalid', stock.error));
    }

    return Product.create({
      id: item.id,
      name: item.name,
      description: item.description,
      price: price.value,
      imageUrl: item.imageUrl,
      stock: stock.value,
      version: item.version,
    });
  }

  /**
   * The cursor is the last evaluated key, base64 encoded.
   *
   * Opaque on purpose: exposing the raw key would let a client craft one, and
   * it would also freeze the key schema into the public API, so changing the
   * table layout would break every paginating client.
   */
  private encodeCursor(key: Record<string, unknown> | undefined): string | null {
    return key === undefined ? null : Buffer.from(JSON.stringify(key)).toString('base64url');
  }

  private decodeCursor(
    cursor: string | undefined,
  ): Result<Record<string, unknown> | undefined, CatalogUnavailable> {
    if (cursor === undefined) {
      return ok(undefined);
    }

    try {
      return ok(
        JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>,
      );
    } catch (cause) {
      return err(new CatalogUnavailable('Malformed pagination cursor', cause));
    }
  }
}
