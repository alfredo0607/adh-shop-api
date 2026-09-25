import { type Result, err, ok } from '../../../shared/domain';

import { InvalidDeliveryAddress } from './checkout.errors';

export interface DeliveryAddressInput {
  readonly addressLine1: string;
  readonly addressLine2?: string | undefined;
  readonly city: string;
  readonly region: string;
  readonly postalCode?: string | undefined;
  readonly country: string;
}

/**
 * Where the product goes.
 *
 * Only Colombia is served. Accepting any country and discovering at dispatch
 * that it cannot be delivered would charge a buyer for something that will
 * never arrive.
 */
export class DeliveryAddress {
  static readonly SERVED_COUNTRIES: readonly string[] = ['CO'];

  private constructor(
    readonly addressLine1: string,
    readonly addressLine2: string | undefined,
    readonly city: string,
    readonly region: string,
    readonly postalCode: string | undefined,
    readonly country: string,
  ) {}

  static create(input: DeliveryAddressInput): Result<DeliveryAddress, InvalidDeliveryAddress> {
    const clean = (value: string | undefined): string | undefined => {
      const trimmed = value?.trim().replace(/\s+/g, ' ');
      return trimmed === '' ? undefined : trimmed;
    };

    const addressLine1 = clean(input.addressLine1);
    const city = clean(input.city);
    const region = clean(input.region);
    const postalCode = clean(input.postalCode);
    const country = input.country.trim().toUpperCase();

    if (addressLine1 === undefined || addressLine1.length < 5 || addressLine1.length > 120) {
      return err(new InvalidDeliveryAddress('Address must be between 5 and 120 characters'));
    }

    if (city === undefined || city.length < 2 || city.length > 60) {
      return err(new InvalidDeliveryAddress('City must be between 2 and 60 characters'));
    }

    if (region === undefined || region.length < 2 || region.length > 60) {
      return err(new InvalidDeliveryAddress('Region must be between 2 and 60 characters'));
    }

    if (postalCode !== undefined && !/^[0-9]{6}$/.test(postalCode)) {
      return err(new InvalidDeliveryAddress('Postal code must have 6 digits'));
    }

    if (!DeliveryAddress.SERVED_COUNTRIES.includes(country)) {
      return err(
        new InvalidDeliveryAddress('Deliveries are only available in Colombia', { country }),
      );
    }

    return ok(
      new DeliveryAddress(
        addressLine1,
        clean(input.addressLine2),
        city,
        region,
        postalCode,
        country,
      ),
    );
  }
}
