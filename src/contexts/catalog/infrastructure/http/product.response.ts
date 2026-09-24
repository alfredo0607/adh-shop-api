import { ApiProperty } from '@nestjs/swagger';

import type { Product } from '../../domain/product';
import type { ProductPage } from '../../domain/product.repository';

/**
 * What a client receives.
 *
 * Built explicitly rather than by returning the entity. Serialising the domain
 * object directly would publish whatever it happens to hold today and republish
 * anything added to it tomorrow — `reserved` is the example here: how many
 * units are held in other people's carts is internal, and exposing it leaks
 * commercial information while telling the buyer nothing useful.
 */
export class ProductResponse {
  @ApiProperty({ example: 'prod-espresso-01' })
  readonly id!: string;

  @ApiProperty({ example: 'Cafetera espresso' })
  readonly name!: string;

  @ApiProperty({ example: 'Manual espresso machine with a 1.5 L tank' })
  readonly description!: string;

  @ApiProperty({ example: 89_990_00, description: 'Integer minor units, never a decimal' })
  readonly priceInCents!: number;

  @ApiProperty({ example: 'COP' })
  readonly currency!: string;

  @ApiProperty({ example: 'https://cdn.example.com/espresso.webp' })
  readonly imageUrl!: string;

  @ApiProperty({ example: 12, description: 'Units a customer can buy right now' })
  readonly availableUnits!: number;

  @ApiProperty({ example: true })
  readonly isPurchasable!: boolean;

  static from(product: Product): ProductResponse {
    const snapshot = product.toSnapshot();

    return {
      id: snapshot.id,
      name: snapshot.name,
      description: snapshot.description,
      priceInCents: snapshot.priceInCents,
      currency: snapshot.currency,
      imageUrl: snapshot.imageUrl,
      availableUnits: snapshot.available,
      isPurchasable: product.isPurchasable,
    };
  }
}

export class ProductPageResponse {
  @ApiProperty({ type: [ProductResponse] })
  readonly items!: ProductResponse[];

  @ApiProperty({
    nullable: true,
    example: 'eyJQSyI6IlBST0RVQ1QjMSJ9',
    description: 'Pass back as ?cursor= to read the next page. Null when there is no more.',
  })
  readonly nextCursor!: string | null;

  static from(page: ProductPage): ProductPageResponse {
    return {
      items: page.items.map((product) => ProductResponse.from(product)),
      nextCursor: page.nextCursor,
    };
  }
}
