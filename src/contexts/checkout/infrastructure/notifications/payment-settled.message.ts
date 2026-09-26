import type { PaymentSettled } from '../../domain/payment-events.port';

/**
 * `payment.settled` version 1: what the payment email Lambda reads.
 *
 * This is a contract with another deployable, so it is shaped here rather
 * than by serialising the domain objects. Renaming a field in the domain must
 * not silently change the message; changing the message means a new version.
 *
 * No card data exists in this service to leak, and the phone number is left
 * out: the email does not need it.
 */
export interface PaymentSettledMessage {
  readonly type: 'payment.settled';
  readonly version: 1;
  readonly transactionId: string;
  readonly status: string;
  readonly occurredAt: string;
  readonly customer: { readonly fullName: string; readonly email: string };
  readonly lines: readonly {
    readonly productId: string;
    readonly name: string;
    readonly units: number;
    readonly unitPriceInCents: number;
    readonly lineTotalInCents: number;
  }[];
  readonly amounts: {
    readonly productInCents: number;
    readonly baseFeeInCents: number;
    readonly deliveryFeeInCents: number;
    readonly totalInCents: number;
    readonly currency: string;
  };
  readonly delivery: {
    readonly addressLine1: string;
    readonly addressLine2?: string;
    readonly city: string;
    readonly region: string;
    readonly postalCode?: string;
    readonly country: string;
    readonly estimatedDeliveryAt?: string;
  };
}

export const toPaymentSettledMessage = ({
  transaction,
  delivery,
  occurredAt,
}: PaymentSettled): PaymentSettledMessage => {
  const { quote, customer, deliveryAddress: address } = transaction;

  return {
    type: 'payment.settled',
    version: 1,
    transactionId: transaction.id,
    status: transaction.status,
    occurredAt: occurredAt.toISOString(),
    customer: { fullName: customer.fullName, email: customer.email },
    lines: quote.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      units: line.units,
      unitPriceInCents: line.unitPriceInCents,
      lineTotalInCents: line.lineTotalInCents,
    })),
    amounts: {
      productInCents: quote.productInCents,
      baseFeeInCents: quote.baseFeeInCents,
      deliveryFeeInCents: quote.deliveryFeeInCents,
      totalInCents: quote.totalInCents,
      currency: quote.currency,
    },
    delivery: {
      addressLine1: address.addressLine1,
      ...(address.addressLine2 === undefined ? {} : { addressLine2: address.addressLine2 }),
      city: address.city,
      region: address.region,
      ...(address.postalCode === undefined ? {} : { postalCode: address.postalCode }),
      country: address.country,
      ...(delivery === undefined
        ? {}
        : { estimatedDeliveryAt: delivery.estimatedDeliveryAt.toISOString() }),
    },
  };
};
