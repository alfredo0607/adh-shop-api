import { DeliveryAddress } from './delivery-address';

describe('DeliveryAddress', () => {
  const valid = {
    addressLine1: 'Calle 93 # 11-26',
    city: 'Bogotá',
    region: 'Cundinamarca',
    country: 'CO',
  };

  it('accepts a Colombian address and normalises it', () => {
    const result = DeliveryAddress.create({
      ...valid,
      addressLine1: '  Calle 93   # 11-26 ',
      addressLine2: '   ',
      postalCode: '110221',
      country: 'co',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.addressLine1).toBe('Calle 93 # 11-26');
    expect(result.value.addressLine2).toBeUndefined();
    expect(result.value.postalCode).toBe('110221');
    expect(result.value.country).toBe('CO');
  });

  it.each([
    ['an address that is too short', { addressLine1: 'C 1' }],
    ['a blank address', { addressLine1: '    ' }],
    ['a missing city', { city: ' ' }],
    ['a region that is too long', { region: 'x'.repeat(61) }],
    ['a postal code with letters', { postalCode: '11O221' }],
    ['a country that is not served', { country: 'US' }],
  ])('rejects %s', (_case, override) => {
    const result = DeliveryAddress.create({ ...valid, ...override });

    expect(result.isErr() && result.error.code).toBe('INVALID_DELIVERY_ADDRESS');
  });
});
