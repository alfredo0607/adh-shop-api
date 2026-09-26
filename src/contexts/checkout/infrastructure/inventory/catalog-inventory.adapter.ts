import { ResultAsync } from '../../../../shared/domain';
import type { CatalogError } from '../../../catalog/domain/catalog.errors';
import type { Product } from '../../../catalog/domain/product';
import type { ProductRepository } from '../../../catalog/domain/product.repository';
import { CheckoutUnavailable, OutOfStock, UnknownProduct } from '../../domain/checkout.errors';
import type { InventoryPort, ProductOffer } from '../../domain/inventory.port';
import type { OrderItem } from '../../domain/quote';

/**
 * Serves the checkout's inventory port from the catalogue module.
 *
 * The only place that knows both vocabularies. Catalogue errors are translated
 * into checkout errors here, so neither domain has to import the other.
 */
export class CatalogInventoryAdapter implements InventoryPort {
  constructor(private readonly products: ProductRepository) {}

  offers(
    productIds: readonly string[],
  ): ResultAsync<ProductOffer[], UnknownProduct | CheckoutUnavailable> {
    return ResultAsync.combine(
      productIds.map((productId) =>
        this.products
          .findById(productId)
          .map(toOffer)
          .mapErr((error) => translate(error) as UnknownProduct | CheckoutUnavailable),
      ),
    );
  }

  reserve(
    items: readonly OrderItem[],
  ): ResultAsync<ProductOffer[], UnknownProduct | OutOfStock | CheckoutUnavailable> {
    return this.products
      .reserveAll(items)
      .map((products) => products.map(toOffer))
      .mapErr(translate);
  }

  release(items: readonly OrderItem[]): ResultAsync<void, CheckoutUnavailable> {
    return this.products
      .releaseAll(items)
      .mapErr(
        (error) =>
          new CheckoutUnavailable(
            `Could not release ${items.map((item) => `${item.units} × ${item.productId}`).join(', ')}`,
            error,
          ),
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

const translate = (error: CatalogError): UnknownProduct | OutOfStock | CheckoutUnavailable => {
  switch (error.code) {
    case 'PRODUCT_NOT_FOUND':
      return new UnknownProduct(
        typeof error.details?.['productId'] === 'string' ? error.details['productId'] : '',
      );
    case 'INSUFFICIENT_STOCK':
      return new OutOfStock(error.productId ?? '', error.requested, error.available);
    default:
      return new CheckoutUnavailable('Could not reach the inventory', error);
  }
};
