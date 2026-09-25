import { type Result, err, ok } from '../../../shared/domain';

import { InvalidCustomer } from './checkout.errors';

// Deliberately permissive. The only reliable check that an address exists is
// sending mail to it; a strict pattern mostly rejects real addresses.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9]{7,15}$/;

export interface CustomerDetails {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
}

/**
 * The person buying.
 *
 * Identified by email: a returning buyer is the same customer, not a new row
 * per purchase. The id is still a random value rather than the email itself,
 * so that nothing downstream — a transaction, a log line — has to carry the
 * address just to refer to the customer.
 */
export class Customer {
  private constructor(
    readonly id: string,
    readonly fullName: string,
    readonly email: string,
    readonly phone: string,
  ) {}

  /** Validates and normalises what the buyer typed. */
  static details(input: CustomerDetails): Result<CustomerDetails, InvalidCustomer> {
    const fullName = input.fullName.trim().replace(/\s+/g, ' ');
    const email = input.email.trim().toLowerCase();
    const phone = input.phone.replace(/[\s()-]/g, '');

    if (fullName.length < 3 || fullName.length > 100) {
      return err(new InvalidCustomer('Full name must be between 3 and 100 characters'));
    }

    if (email.length > 254 || !EMAIL.test(email)) {
      return err(new InvalidCustomer('Email address is not valid'));
    }

    if (!PHONE.test(phone)) {
      return err(new InvalidCustomer('Phone number must have between 7 and 15 digits'));
    }

    return ok({ fullName, email, phone });
  }

  static restore(input: CustomerDetails & { id: string }): Customer {
    return new Customer(input.id, input.fullName, input.email, input.phone);
  }

  /**
   * The address with most of the local part hidden, for responses.
   *
   * A transaction is readable by anyone holding its id. The id is unguessable,
   * but it also travels in URLs and browser history, so the response carries
   * no more personal data than the buyer needs to recognise their own order.
   */
  get maskedEmail(): string {
    const [local = '', domain = ''] = this.email.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }
}
