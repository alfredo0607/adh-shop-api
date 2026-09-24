import { type Result, err, ok } from '../../../shared/domain';

import { type InsufficientStock, type InvalidProduct, type InvalidStock } from './catalog.errors';
import { InvalidProduct as InvalidProductError } from './catalog.errors';
import type { Money } from './money';
import type { Stock } from './stock';

export interface ProductSnapshot {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly priceInCents: number;
  readonly currency: string;
  readonly imageUrl: string;
  readonly available: number;
  readonly reserved: number;
  readonly version: number;
}

/**
 * A product on sale.
 *
 * The stock transitions live here rather than in a use case. A use case that
 * read `product.stock.available` and compared it itself would be doing the
 * entity's job, and the second place that needed the same rule would copy it —
 * at which point the two copies start to drift. Asking the product to reserve
 * units keeps the rule in one place and makes it impossible to bypass.
 *
 * Immutable: every transition returns a new Product. A mutable entity shared
 * between two concurrent requests is a data race waiting to happen, and the
 * version below exists precisely so that race is detected at the store rather
 * than in memory.
 */
export class Product {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly description: string,
    readonly price: Money,
    readonly imageUrl: string,
    readonly stock: Stock,
    /**
     * Incremented on every change, and used by the persistence adapter as an
     * optimistic lock. Two requests that read the same product and both write
     * back would otherwise have the second silently overwrite the first.
     */
    readonly version: number,
  ) {}

  static create(input: {
    id: string;
    name: string;
    description: string;
    price: Money;
    imageUrl: string;
    stock: Stock;
    version?: number;
  }): Result<Product, InvalidProduct> {
    if (input.id.trim().length === 0) {
      return err(new InvalidProductError('Product id cannot be empty'));
    }

    if (input.name.trim().length === 0) {
      return err(new InvalidProductError('Product name cannot be empty', { id: input.id }));
    }

    return ok(
      new Product(
        input.id,
        input.name,
        input.description,
        input.price,
        input.imageUrl,
        input.stock,
        input.version ?? 0,
      ),
    );
  }

  get isPurchasable(): boolean {
    return !this.stock.isSoldOut;
  }

  reserve(units: number): Result<Product, InsufficientStock | InvalidStock> {
    return this.stock.reserve(units).map((stock) => this.withStock(stock));
  }

  confirmReservation(units: number): Result<Product, InsufficientStock | InvalidStock> {
    return this.stock.confirm(units).map((stock) => this.withStock(stock));
  }

  releaseReservation(units: number): Result<Product, InsufficientStock | InvalidStock> {
    return this.stock.release(units).map((stock) => this.withStock(stock));
  }

  toSnapshot(): ProductSnapshot {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      priceInCents: this.price.amountInCents,
      currency: this.price.currency,
      imageUrl: this.imageUrl,
      available: this.stock.available,
      reserved: this.stock.reserved,
      version: this.version,
    };
  }

  private withStock(stock: Stock): Product {
    return new Product(
      this.id,
      this.name,
      this.description,
      this.price,
      this.imageUrl,
      stock,
      this.version + 1,
    );
  }
}
