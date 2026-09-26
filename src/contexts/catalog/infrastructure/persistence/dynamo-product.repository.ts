import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { ResultAsync, err, ok, type Result } from '../../../../shared/domain';
import {
  CatalogUnavailable,
  InsufficientStock,
  InvalidCursor,
  ProductNotFound,
  type InvalidProduct,
} from '../../domain/catalog.errors';
import { Money } from '../../domain/money';
import { Product } from '../../domain/product';
import type {
  ProductPage,
  ProductRepository,
  StockLine,
  StockTransitionError,
} from '../../domain/product.repository';
import { Stock, checkStockLines } from '../../domain/stock';

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
  category: string;
  priceInCents: number;
  currency: string;
  imageKey: string;
  available: number;
  reserved: number;
  version: number;
}

const PRODUCT_PARTITION = 'PRODUCT';

/**
 * Exported because the checkout settles a payment and moves this product's
 * stock in one DynamoDB transaction, which has to name the item by its key.
 */
export const productKey = (id: string): { PK: string; SK: string } => ({
  PK: `${PRODUCT_PARTITION}#${id}`,
  SK: '#META',
});

export class DynamoProductRepository implements ProductRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  findAll(query: {
    limit: number;
    cursor?: string | undefined;
  }): ResultAsync<ProductPage, InvalidCursor | CatalogUnavailable> {
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
    ).andThen((response): Result<ProductPage, InvalidCursor | CatalogUnavailable> => {
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
          Key: productKey(id),
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
   * Moves units from available to reserved for every line of an order, in one
   * DynamoDB transaction: all the products are held, or none is.
   *
   * Two buyers reaching for the last unit both read `available: 1`, and in a
   * read-modify-write both would pass the check in memory and both would write
   * back a successful reservation. Here each line carries the condition
   * `available >= :units`, evaluated by DynamoDB while it holds the item, so
   * exactly one of the two succeeds.
   *
   * The products are read first because a transaction returns no attributes,
   * and the checkout needs each name and price. Each line is also conditioned
   * on the price read, so the price charged is the price of the units held
   * even if it changed in between.
   */
  reserveAll(lines: readonly StockLine[]): ResultAsync<Product[], StockTransitionError> {
    const checked = checkStockLines(lines);
    if (checked.isErr()) {
      return ResultAsync.err(checked.error);
    }

    return ResultAsync.combine<Product, StockTransitionError>(
      checked.value.map((line) => this.findById(line.productId)),
    ).andThen((products) => {
      const reserved: Product[] = [];
      for (const [index, product] of products.entries()) {
        const next = product.reserve(checked.value[index]!.units);
        if (next.isErr()) {
          const error = next.error;
          return ResultAsync.err<StockTransitionError, Product[]>(
            error instanceof InsufficientStock ? error.forProduct(product.id) : error,
          );
        }
        reserved.push(next.value);
      }

      return this.transact(
        checked.value.map((line, index) => ({
          line,
          update:
            'SET #available = #available - :units, #reserved = #reserved + :units, #version = #version + :one',
          condition: 'attribute_exists(PK) AND #available >= :units AND #price = :price',
          price: products[index]!.price.amountInCents,
        })),
        'available',
      ).map(() => reserved);
    });
  }

  /** Returns held units to the shelf after a declined or abandoned payment. */
  releaseAll(lines: readonly StockLine[]): ResultAsync<void, StockTransitionError> {
    return this.transitionAll(
      lines,
      'SET #available = #available + :units, #reserved = #reserved - :units, #version = #version + :one',
    );
  }

  /** Turns a reservation into a sale: the units leave the product. */
  confirmAll(lines: readonly StockLine[]): ResultAsync<void, StockTransitionError> {
    return this.transitionAll(
      lines,
      'SET #reserved = #reserved - :units, #version = #version + :one',
    );
  }

  private transitionAll(
    lines: readonly StockLine[],
    update: string,
  ): ResultAsync<void, StockTransitionError> {
    const checked = checkStockLines(lines);
    if (checked.isErr()) {
      return ResultAsync.err(checked.error);
    }

    return this.transact(
      checked.value.map((line) => ({
        line,
        update,
        condition: 'attribute_exists(PK) AND #reserved >= :units',
      })),
      'reserved',
    );
  }

  private transact(
    operations: readonly {
      line: StockLine;
      update: string;
      condition: string;
      price?: number;
    }[],
    shortfall: 'available' | 'reserved',
  ): ResultAsync<void, StockTransitionError> {
    return ResultAsync.fromPromise(
      this.client.send(
        new TransactWriteCommand({
          TransactItems: operations.map(({ line, update, condition, price }) => ({
            Update: {
              TableName: this.tableName,
              Key: productKey(line.productId),
              UpdateExpression: update,
              ConditionExpression: condition,
              // `available`, `reserved` and `version` are reserved words in
              // DynamoDB's expression grammar.
              ExpressionAttributeNames: {
                '#available': 'available',
                '#reserved': 'reserved',
                '#version': 'version',
                ...(price === undefined ? {} : { '#price': 'priceInCents' }),
              },
              ExpressionAttributeValues: {
                ':units': line.units,
                ':one': 1,
                ...(price === undefined ? {} : { ':price': price }),
              },
              // Without the item back there is no way to tell "no such product"
              // from "not enough units": DynamoDB reports both the same way,
              // and every sold-out product would answer 404 instead of 409.
              ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
            },
          })),
        }),
      ),
      (cause) =>
        explainFailure(
          cause,
          operations.map(({ line }) => line),
          shortfall,
        ),
    ).map(() => undefined);
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
      category: item.category,
      price: price.value,
      imageKey: item.imageKey,
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

  /**
   * Accepts only what `encodeCursor` produces: an object holding exactly the
   * four key attributes of a product in the listing index.
   *
   * Anything else is refused here rather than sent to DynamoDB. A foreign key
   * would be rejected by the store anyway, but as an error indistinguishable
   * from the store being down; and a key from another partition must never be
   * used as a starting point at all.
   */
  private decodeCursor(
    cursor: string | undefined,
  ): Result<Record<string, string> | undefined, InvalidCursor> {
    if (cursor === undefined) {
      return ok(undefined);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      return err(new InvalidCursor());
    }

    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return err(new InvalidCursor());
    }

    const key = decoded as Record<string, unknown>;
    const attributes = Object.keys(key).sort();
    const isProductKey =
      attributes.join(',') === 'GSI1PK,GSI1SK,PK,SK' &&
      attributes.every((name) => typeof key[name] === 'string') &&
      key['GSI1PK'] === PRODUCT_PARTITION &&
      key['PK'] === `${PRODUCT_PARTITION}#${String(key['GSI1SK'])}` &&
      key['SK'] === '#META';

    return isProductKey ? ok(key as Record<string, string>) : err(new InvalidCursor());
  }
}

/**
 * Reads a numeric attribute from an item returned with a cancellation, which
 * arrives in DynamoDB's wire format (`{ N: "3" }`) even through the document
 * client.
 */
const numberAttribute = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'N' in value) {
    return Number((value as { N: string }).N);
  }
  return 0;
};

/**
 * Turns a cancelled transaction into the reason the buyer needs. DynamoDB lists
 * one cancellation reason per operation, in order; the failed ones carry the
 * item as it was, which tells a missing product from a short one.
 */
const explainFailure = (
  cause: unknown,
  lines: readonly StockLine[],
  shortfall: 'available' | 'reserved',
): StockTransitionError => {
  if (!(cause instanceof TransactionCanceledException)) {
    return new CatalogUnavailable('Could not update stock', cause);
  }

  const reasons = cause.CancellationReasons ?? [];
  for (const [index, reason] of reasons.entries()) {
    const line = lines[index];
    if (line === undefined || reason.Code !== 'ConditionalCheckFailed') continue;

    const item = reason.Item as Record<string, unknown> | undefined;
    if (item === undefined) {
      return new ProductNotFound(line.productId);
    }

    const held = numberAttribute(item[shortfall]);
    if (held < line.units) {
      return new InsufficientStock(line.units, held, line.productId);
    }

    // Enough units, so the price moved between the read and the write.
    return new CatalogUnavailable('A price changed while the order was being placed', cause);
  }

  // Another transaction touched one of the items at the same moment. Nothing
  // was written, so asking again is safe.
  return new CatalogUnavailable('Stock is busy; try again', cause);
};
