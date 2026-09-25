import { ResultAsync } from '../../../../shared/domain';
import type { PaymentGatewayUnavailable, PaymentRejected } from '../../domain/checkout.errors';
import type {
  CardCharge,
  GatewayPayment,
  PaymentGatewayPort,
  PaymentTerms,
} from '../../domain/payment-gateway.port';

/**
 * A payment gateway for tests: records every charge and answers with whatever
 * outcome the test sets up.
 */
export class FakePaymentGateway implements PaymentGatewayPort {
  readonly charges: CardCharge[] = [];
  nextCharge: ResultAsync<GatewayPayment, PaymentRejected | PaymentGatewayUnavailable> =
    ResultAsync.ok({ gatewayTransactionId: 'gw-1', status: 'PENDING', amountInCents: 0 });

  terms(): ResultAsync<PaymentTerms, PaymentGatewayUnavailable> {
    return ResultAsync.ok({
      publicKey: 'pub_test',
      cardTokenizationUrl: 'https://gateway.test/v1/tokens/cards',
      acceptance: { token: 'acceptance', documentUrl: 'https://gateway.test/terms.pdf' },
      personalDataAuthorization: {
        token: 'personal-data',
        documentUrl: 'https://gateway.test/data.pdf',
      },
    });
  }

  charge(
    request: CardCharge,
  ): ResultAsync<GatewayPayment, PaymentRejected | PaymentGatewayUnavailable> {
    this.charges.push(request);
    return this.nextCharge;
  }

  /** What `find` reports; PENDING until a test says otherwise. */
  nextFind: ResultAsync<GatewayPayment, PaymentGatewayUnavailable> | undefined;

  /** What `findByReference` reports; nothing found unless a test says otherwise. */
  nextFindByReference: ResultAsync<GatewayPayment | undefined, PaymentGatewayUnavailable> =
    ResultAsync.ok(undefined);

  findByReference(
    _reference: string,
  ): ResultAsync<GatewayPayment | undefined, PaymentGatewayUnavailable> {
    return this.nextFindByReference;
  }

  find(gatewayTransactionId: string): ResultAsync<GatewayPayment, PaymentGatewayUnavailable> {
    return (
      this.nextFind ?? ResultAsync.ok({ gatewayTransactionId, status: 'PENDING', amountInCents: 0 })
    );
  }
}
