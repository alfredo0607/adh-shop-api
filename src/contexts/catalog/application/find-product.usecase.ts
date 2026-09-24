import type { ResultAsync } from '../../../shared/domain';
import type { CatalogUnavailable, ProductNotFound } from '../domain/catalog.errors';
import type { Product } from '../domain/product';
import type { ProductRepository } from '../domain/product.repository';

export class FindProduct {
  constructor(private readonly products: ProductRepository) {}

  execute(productId: string): ResultAsync<Product, ProductNotFound | CatalogUnavailable> {
    return this.products.findById(productId);
  }
}
