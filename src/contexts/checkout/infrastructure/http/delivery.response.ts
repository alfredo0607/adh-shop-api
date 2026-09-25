import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { Delivery, DeliveryStatus } from '../../domain/delivery';

class DeliveryAddressView {
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

export class DeliveryResponse {
  @ApiProperty({ example: '6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60' })
  readonly transactionId!: string;

  @ApiProperty({ enum: ['PREPARING', 'SHIPPED', 'DELIVERED'], example: 'PREPARING' })
  readonly status!: DeliveryStatus;

  @ApiProperty({ example: 'prod-espresso-01' })
  readonly productId!: string;

  @ApiProperty({ example: 'Cafetera espresso Artigiano' })
  readonly productName!: string;

  @ApiProperty({ example: 1 })
  readonly units!: number;

  @ApiProperty({ example: 'Laura Gómez' })
  readonly recipientName!: string;

  @ApiProperty({ example: '*********4567', description: 'Masked on purpose' })
  readonly recipientPhone!: string;

  @ApiProperty({ type: DeliveryAddressView })
  readonly address!: DeliveryAddressView;

  @ApiProperty({ example: '2026-09-24T18:00:05.000Z' })
  readonly createdAt!: string;

  @ApiProperty({ example: '2026-09-29T18:00:05.000Z' })
  readonly estimatedDeliveryAt!: string;

  static from(delivery: Delivery): DeliveryResponse {
    const { address } = delivery;

    return {
      transactionId: delivery.transactionId,
      status: delivery.status,
      productId: delivery.productId,
      productName: delivery.productName,
      units: delivery.units,
      recipientName: delivery.recipientName,
      recipientPhone: delivery.maskedRecipientPhone,
      address: {
        addressLine1: address.addressLine1,
        ...(address.addressLine2 === undefined ? {} : { addressLine2: address.addressLine2 }),
        city: address.city,
        region: address.region,
        ...(address.postalCode === undefined ? {} : { postalCode: address.postalCode }),
        country: address.country,
      },
      createdAt: delivery.createdAt.toISOString(),
      estimatedDeliveryAt: delivery.estimatedDeliveryAt.toISOString(),
    };
  }
}
