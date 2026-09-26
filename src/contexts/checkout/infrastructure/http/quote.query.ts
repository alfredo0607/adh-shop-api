import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

import type { OrderItem } from '../../domain/quote';

/** `<productId>:<units>`, comma-separated, up to ten items. */
const ITEMS_PATTERN = /^[A-Za-z0-9_-]{1,64}:\d{1,2}(,[A-Za-z0-9_-]{1,64}:\d{1,2}){0,9}$/;

/**
 * The order to price, as one query parameter.
 *
 * A quote reads and changes nothing, so it stays a GET: safe to retry and to
 * repeat. One compact parameter rather than repeated ones, because clients
 * disagree on how to encode arrays in a query string, and this format has
 * exactly one spelling. It is checked by a strict pattern before it is
 * parsed; limits on units and distinct products are the domain's to enforce.
 */
export class QuoteQuery {
  @ApiProperty({
    example: 'prod-espresso-01:1,prod-grinder-02:2',
    description:
      'Comma-separated `productId:units` pairs, one per product, up to 10. ' +
      'Each product may appear once, with 1 to 10 units.',
  })
  @IsString()
  @MaxLength(700)
  @Matches(ITEMS_PATTERN, { message: 'items must be productId:units pairs, comma-separated' })
  readonly items!: string;

  static parse(query: QuoteQuery): OrderItem[] {
    return query.items.split(',').map((pair) => {
      const separator = pair.lastIndexOf(':');
      return { productId: pair.slice(0, separator), units: Number(pair.slice(separator + 1)) };
    });
  }
}
