import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Shape only. These decorators decide whether the request can be read at all;
 * whether an email is plausible or a country is served is decided by the
 * domain, which returns a specific error code the client can act on.
 *
 * The length caps are here too, because they protect the server rather than
 * express a business rule: nothing should parse a megabyte-long name.
 */
export class CustomerBody {
  @ApiProperty({ example: 'Laura Gómez' })
  @IsString()
  @MaxLength(100)
  readonly fullName!: string;

  @ApiProperty({ example: 'laura@example.com' })
  @IsString()
  @MaxLength(254)
  readonly email!: string;

  @ApiProperty({ example: '+573001234567' })
  @IsString()
  @MaxLength(20)
  readonly phone!: string;
}

export class DeliveryAddressBody {
  @ApiProperty({ example: 'Calle 93 # 11-26' })
  @IsString()
  @MaxLength(120)
  readonly addressLine1!: string;

  @ApiPropertyOptional({ example: 'Apartamento 502' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  readonly addressLine2?: string;

  @ApiProperty({ example: 'Bogotá' })
  @IsString()
  @MaxLength(60)
  readonly city!: string;

  @ApiProperty({ example: 'Cundinamarca' })
  @IsString()
  @MaxLength(60)
  readonly region!: string;

  @ApiPropertyOptional({ example: '110221' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  readonly postalCode?: string;

  @ApiProperty({ example: 'CO', description: 'ISO 3166-1 alpha-2. Only CO is served.' })
  @IsString()
  @Length(2, 2)
  readonly country!: string;
}

export class OrderItemBody {
  @ApiProperty({ example: 'prod-espresso-01' })
  @IsString()
  @Length(1, 64)
  readonly productId!: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  readonly units!: number;
}

export class CreateTransactionBody {
  @ApiProperty({
    type: [OrderItemBody],
    minItems: 1,
    maxItems: 10,
    description: 'One entry per product; each product may appear once.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => OrderItemBody)
  readonly items!: OrderItemBody[];

  @ApiProperty({
    example: 91_690_00,
    description:
      'The total shown to the buyer, from GET /quotes. The server recomputes it and answers ' +
      '422 AMOUNT_MISMATCH if it no longer matches, so a buyer is never charged an amount ' +
      'they did not see.',
  })
  @IsInt()
  @Min(0)
  readonly expectedTotalInCents!: number;

  @ApiProperty({ type: CustomerBody })
  @IsDefined()
  @ValidateNested()
  @Type(() => CustomerBody)
  readonly customer!: CustomerBody;

  @ApiProperty({ type: DeliveryAddressBody })
  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryAddressBody)
  readonly deliveryAddress!: DeliveryAddressBody;
}
