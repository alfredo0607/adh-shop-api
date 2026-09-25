import type { ResultAsync } from '../../../shared/domain';

import type { CheckoutUnavailable } from './checkout.errors';
import type { Customer, CustomerDetails } from './customer';

export interface CustomerRepository {
  /**
   * Records the buyer, or updates them if the email is already known.
   *
   * One atomic upsert rather than find-then-create: two checkouts from the same
   * buyer at once would otherwise both miss, both create, and leave one person
   * as two customers. `newId` is used only when the customer is new.
   */
  register(details: CustomerDetails, newId: string): ResultAsync<Customer, CheckoutUnavailable>;
}

export const CUSTOMER_REPOSITORY = Symbol('CustomerRepository');
