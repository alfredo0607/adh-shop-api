import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import type { PaymentTerms } from '../../domain/payment-gateway.port';

/**
 * No card number, no CVC, no expiry: the storefront sends those to the gateway
 * and receives a token. This service never holds card data, so it has none to
 * leak and stays out of scope for most of PCI DSS.
 */
export class PayTransactionBody {
  @ApiProperty({
    example: 'tok_stagtest_5113_9eD2BcDd13A3e8E0a3b7cc5B0CA2b1b4',
    description: 'Card token issued by the payment gateway from the storefront',
  })
  @IsString()
  @MaxLength(100)
  @Matches(/^tok_[A-Za-z0-9_]+$/, { message: 'cardToken must be a card token, not card data' })
  readonly cardToken!: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 36 })
  @IsInt()
  @Min(1)
  @Max(36)
  readonly installments!: number;

  @ApiProperty({ description: 'From GET /payment-terms, once the buyer accepts the terms' })
  @IsString()
  @MaxLength(2000)
  readonly acceptanceToken!: string;

  @ApiProperty({
    description: 'From GET /payment-terms, once the buyer authorises the use of personal data',
  })
  @IsString()
  @MaxLength(2000)
  readonly personalDataAuthorizationToken!: string;
}

class AcceptanceDocument {
  @ApiProperty()
  readonly token!: string;

  @ApiProperty({ description: 'The document the buyer must be shown and accept' })
  readonly documentUrl!: string;
}

export class PaymentTermsResponse {
  @ApiProperty({ description: 'Public key for card tokenisation. Public by design.' })
  readonly publicKey!: string;

  @ApiProperty({ description: 'Where the storefront posts card data to obtain a token' })
  readonly cardTokenizationUrl!: string;

  @ApiProperty({ type: AcceptanceDocument })
  readonly acceptance!: AcceptanceDocument;

  @ApiProperty({ type: AcceptanceDocument })
  readonly personalDataAuthorization!: AcceptanceDocument;

  static from(terms: PaymentTerms): PaymentTermsResponse {
    return {
      publicKey: terms.publicKey,
      cardTokenizationUrl: terms.cardTokenizationUrl,
      acceptance: { ...terms.acceptance },
      personalDataAuthorization: { ...terms.personalDataAuthorization },
    };
  }
}
