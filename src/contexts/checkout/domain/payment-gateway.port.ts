import type { ResultAsync } from '../../../shared/domain';

import type { PaymentGatewayUnavailable, PaymentRejected } from './checkout.errors';
import type { GatewayStatus } from './transaction';

/**
 * What the buyer must accept before being charged, and how the storefront
 * turns a card into a token without the card ever reaching this service.
 */
export interface PaymentTerms {
  readonly publicKey: string;
  readonly cardTokenizationUrl: string;
  readonly acceptance: { readonly token: string; readonly documentUrl: string };
  readonly personalDataAuthorization: { readonly token: string; readonly documentUrl: string };
}

export interface CardCharge {
  readonly reference: string;
  readonly amountInCents: number;
  readonly currency: string;
  readonly customerEmail: string;
  readonly cardToken: string;
  readonly installments: number;
  readonly acceptanceToken: string;
  readonly personalDataAuthorizationToken: string;
}

export interface GatewayPayment {
  readonly gatewayTransactionId: string;
  readonly status: GatewayStatus;
  readonly amountInCents: number;
}

/**
 * Named for what the checkout needs, not for who provides it. The domain
 * cannot tell which payment provider is behind this port.
 */
export interface PaymentGatewayPort {
  terms(): ResultAsync<PaymentTerms, PaymentGatewayUnavailable>;

  charge(
    request: CardCharge,
  ): ResultAsync<GatewayPayment, PaymentRejected | PaymentGatewayUnavailable>;

  find(gatewayTransactionId: string): ResultAsync<GatewayPayment, PaymentGatewayUnavailable>;

  /**
   * Looks a payment up by our reference, for when the charge call timed out
   * before the gateway's id came back. `undefined` means the gateway has no
   * payment with that reference.
   */
  findByReference(
    reference: string,
  ): ResultAsync<GatewayPayment | undefined, PaymentGatewayUnavailable>;
}

export const PAYMENT_GATEWAY_PORT = Symbol('PaymentGatewayPort');
