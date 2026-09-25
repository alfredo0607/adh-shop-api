import type { ResultAsync } from '../../../shared/domain';
import type { PaymentGatewayUnavailable } from '../domain/checkout.errors';
import type { PaymentGatewayPort, PaymentTerms } from '../domain/payment-gateway.port';

/**
 * What the storefront needs before it can take a card: the documents the buyer
 * must accept, and where to turn the card into a token.
 *
 * Served by the API so the storefront carries no payment configuration of its
 * own, and switching gateways does not mean redeploying it.
 */
export class GetPaymentTerms {
  constructor(private readonly gateway: PaymentGatewayPort) {}

  execute(): ResultAsync<PaymentTerms, PaymentGatewayUnavailable> {
    return this.gateway.terms();
  }
}
