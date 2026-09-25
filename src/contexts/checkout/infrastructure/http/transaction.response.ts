import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { Quote } from '../../domain/quote';
import type { Transaction, TransactionStatus } from '../../domain/transaction';

const STATUSES: TransactionStatus[] = [
  'PENDING',
  'APPROVED',
  'DECLINED',
  'VOIDED',
  'ERROR',
  'EXPIRED',
];

export class AmountsResponse {
  @ApiProperty({ example: 89_990_00 })
  readonly productInCents!: number;

  @ApiProperty({ example: 500_00 })
  readonly baseFeeInCents!: number;

  @ApiProperty({ example: 1_200_00 })
  readonly deliveryFeeInCents!: number;

  @ApiProperty({ example: 91_690_00 })
  readonly totalInCents!: number;

  @ApiProperty({ example: 'COP' })
  readonly currency!: string;

  static from(quote: Quote): AmountsResponse {
    return {
      productInCents: quote.productInCents,
      baseFeeInCents: quote.baseFeeInCents,
      deliveryFeeInCents: quote.deliveryFeeInCents,
      totalInCents: quote.totalInCents,
      currency: quote.currency,
    };
  }
}

export class QuoteResponse {
  @ApiProperty({ example: 'prod-espresso-01' })
  readonly productId!: string;

  @ApiProperty({ example: 1 })
  readonly units!: number;

  @ApiProperty({ example: 89_990_00 })
  readonly unitPriceInCents!: number;

  @ApiProperty({ type: AmountsResponse })
  readonly amounts!: AmountsResponse;

  static from(productId: string, quote: Quote): QuoteResponse {
    return {
      productId,
      units: quote.units,
      unitPriceInCents: quote.unitPriceInCents,
      amounts: AmountsResponse.from(quote),
    };
  }
}

class PurchasedProductResponse {
  @ApiProperty({ example: 'prod-espresso-01' })
  readonly id!: string;

  @ApiProperty({ example: 'Cafetera espresso Artigiano' })
  readonly name!: string;

  @ApiProperty({ example: 1 })
  readonly units!: number;

  @ApiProperty({ example: 89_990_00 })
  readonly unitPriceInCents!: number;
}

class CustomerResponse {
  @ApiProperty({ example: 'Laura Gómez' })
  readonly fullName!: string;

  @ApiProperty({ example: 'l***@example.com', description: 'Masked on purpose' })
  readonly email!: string;
}

class DeliveryAddressResponse {
  @ApiProperty({ example: 'Calle 93 # 11-26' })
  readonly addressLine1!: string;

  @ApiPropertyOptional({ example: 'Apartamento 502' })
  readonly addressLine2?: string;

  @ApiProperty({ example: 'Bogotá' })
  readonly city!: string;

  @ApiProperty({ example: 'Cundinamarca' })
  readonly region!: string;

  @ApiPropertyOptional({ example: '110221' })
  readonly postalCode?: string;

  @ApiProperty({ example: 'CO' })
  readonly country!: string;
}

/**
 * A transaction as the storefront sees it.
 *
 * Built field by field. The phone number and the full email address are held
 * on the order for delivery, and nothing on the buyer's screen needs them.
 */
export class TransactionResponse {
  @ApiProperty({ example: '6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60' })
  readonly id!: string;

  @ApiProperty({ example: '6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60' })
  readonly reference!: string;

  @ApiProperty({ enum: STATUSES, example: 'PENDING' })
  readonly status!: TransactionStatus;

  @ApiProperty({
    example: false,
    description:
      'Whether a payment was already sent for this transaction. After a refresh, the ' +
      'storefront uses it to wait for the outcome instead of asking for the card again.',
  })
  readonly paymentSubmitted!: boolean;

  @ApiProperty({ type: PurchasedProductResponse })
  readonly product!: PurchasedProductResponse;

  @ApiProperty({ type: AmountsResponse })
  readonly amounts!: AmountsResponse;

  @ApiProperty({ type: CustomerResponse })
  readonly customer!: CustomerResponse;

  @ApiProperty({ type: DeliveryAddressResponse })
  readonly deliveryAddress!: DeliveryAddressResponse;

  @ApiProperty({
    example: '2026-09-24T18:15:00.000Z',
    description: 'Unpaid past this moment, the reserved units return to stock',
  })
  readonly reservationExpiresAt!: string;

  @ApiProperty({ example: '2026-09-24T18:00:00.000Z' })
  readonly createdAt!: string;

  @ApiProperty({ example: '2026-09-24T18:00:00.000Z' })
  readonly updatedAt!: string;

  static from(transaction: Transaction): TransactionResponse {
    const { quote, customer, deliveryAddress: address } = transaction;

    return {
      id: transaction.id,
      reference: transaction.reference,
      status: transaction.status,
      paymentSubmitted: transaction.paymentSubmitted,
      product: {
        id: transaction.product.id,
        name: transaction.product.name,
        units: quote.units,
        unitPriceInCents: quote.unitPriceInCents,
      },
      amounts: AmountsResponse.from(quote),
      customer: { fullName: customer.fullName, email: customer.maskedEmail },
      deliveryAddress: {
        addressLine1: address.addressLine1,
        ...(address.addressLine2 === undefined ? {} : { addressLine2: address.addressLine2 }),
        city: address.city,
        region: address.region,
        ...(address.postalCode === undefined ? {} : { postalCode: address.postalCode }),
        country: address.country,
      },
      reservationExpiresAt: transaction.reservationExpiresAt.toISOString(),
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
    };
  }
}
