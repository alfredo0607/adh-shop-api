import { Customer } from './customer';

describe('Customer', () => {
  const valid = { fullName: 'Laura Gómez', email: 'laura@example.com', phone: '+573001234567' };

  describe('details', () => {
    it('normalises what the buyer typed', () => {
      const result = Customer.details({
        fullName: '  Laura   Gómez ',
        email: ' Laura@Example.COM ',
        phone: '+57 (300) 123-4567',
      });

      expect(result.isOk() && result.value).toEqual({
        fullName: 'Laura Gómez',
        email: 'laura@example.com',
        phone: '+573001234567',
      });
    });

    it.each([
      ['a name that is too short', { fullName: 'Al' }],
      ['a name that is too long', { fullName: 'x'.repeat(101) }],
      ['an email without a domain', { email: 'laura@' }],
      ['an email without a dot in the domain', { email: 'laura@example' }],
      ['an email with spaces', { email: 'la ura@example.com' }],
      ['a phone with letters', { phone: '300-ABC-4567' }],
      ['a phone that is too short', { phone: '12345' }],
    ])('rejects %s', (_case, override) => {
      const result = Customer.details({ ...valid, ...override });

      expect(result.isErr() && result.error.code).toBe('INVALID_CUSTOMER');
    });
  });

  it('masks the email for responses, keeping only what identifies it to its owner', () => {
    const customer = Customer.restore({ ...valid, id: 'c-1' });

    expect(customer.maskedEmail).toBe('l***@example.com');
  });
});
