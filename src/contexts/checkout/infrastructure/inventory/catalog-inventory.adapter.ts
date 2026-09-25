import type { ResultAsync } from '../../../../shared/domain';
import type { CatalogError } from '../../../catalog/domain/catalog.errors';
import type { Product } from '../../../catalog/domain/product';
import type { ProductRepository } from '../../../catalog/domain/product.repository';
import { CheckoutUnavailable, OutOfStock, UnknownProduct } from '../../domain/checkout.errors';
import type { InventoryPort, ProductOffer } from '../../domain/inventory.port';

/**
 * Serves the checkout's inventory port from the catalogue module.
 *
 * The only place that knows both vocabularies. Catalogue errors are translated
 * into checkout errors here, so neither domain has to import the other.
 */
export class CatalogInventoryAdapter implements InventoryPort {
  constructor(private readonly products: ProductRepository) {}

  offer(productId: string): ResultAsync<ProductOffer, UnknownProduct | CheckoutUnavailable> {
    return this.products
      .findById(productId)
      .map(toOffer)
      .mapErr((error) => translate(productId, 0, error) as UnknownProduct | CheckoutUnavailable);
  }

  reserve(
    productId: string,
    units: number,
  ): ResultAsync<ProductOffer, UnknownProduct | OutOfStock | CheckoutUnavailable> {
    return this.products
      .reserveUnits(productId, units)
      .map(toOffer)
      .mapErr((error) => translate(productId, units, error));
  }

  release(productId: string, units: number): ResultAsync<void, CheckoutUnavailable> {
    return this.products
      .releaseUnits(productId, units)
      .map(() => undefined)
      .mapErr(
        (error) =>
          new CheckoutUnavailable(`Could not release ${units} units of ${productId}`, error),
      );
  }
}

const toOffer = (product: Product): ProductOffer => ({
  productId: product.id,
  name: product.name,
  unitPriceInCents: product.price.amountInCents,
  currency: product.price.currency,
  availableUnits: product.stock.available,
});

const translate = (
  productId: string,
  requested: number,
  error: CatalogError,
): UnknownProduct | OutOfStock | CheckoutUnavailable => {
  switch (error.code) {
    case 'PRODUCT_NOT_FOUND':
      return new UnknownProduct(productId);
    case 'INSUFFICIENT_STOCK':
      return new OutOfStock(productId, requested, Number(error.details?.['available'] ?? 0));
    default:
      return new CheckoutUnavailable('Could not reach the inventory', error);
  }
};
