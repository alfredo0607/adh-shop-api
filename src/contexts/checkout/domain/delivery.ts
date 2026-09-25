import type { DeliveryAddress } from './delivery-address';
import type { Transaction } from './transaction';

/**
 * PREPARING is the only status this service sets. The later ones belong to a
 * fulfilment process that does not exist yet; they are named so the contract
 * does not change when it does.
 */
export type DeliveryStatus = 'PREPARING' | 'SHIPPED' | 'DELIVERED';

/**
 * The product assigned to a buyer once their payment is approved.
 *
 * One per approved transaction, created in the same write that approves it:
 * an approved payment with no delivery would be money taken for nothing.
 */
export class Delivery {
  /** Business days promised on the confirmation screen. */
  static readonly ESTIMATED_DAYS = 3;

  private constructor(
    readonly transactionId: string,
    readonly status: DeliveryStatus,
    readonly productId: string,
    readonly productName: string,
    readonly units: number,
    readonly recipientName: string,
    readonly recipientPhone: string,
    readonly address: DeliveryAddress,
    readonly createdAt: Date,
    readonly estimatedDeliveryAt: Date,
  ) {}

  static forApproved(transaction: Transaction, now: Date): Delivery {
    return new Delivery(
      transaction.id,
      'PREPARING',
      transaction.product.id,
      transaction.product.name,
      transaction.quote.units,
      transaction.customer.fullName,
      transaction.customer.phone,
      transaction.deliveryAddress,
      now,
      addBusinessDays(now, Delivery.ESTIMATED_DAYS),
    );
  }

  static restore(input: {
    transactionId: string;
    status: DeliveryStatus;
    productId: string;
    productName: string;
    units: number;
    recipientName: string;
    recipientPhone: string;
    address: DeliveryAddress;
    createdAt: Date;
    estimatedDeliveryAt: Date;
  }): Delivery {
    return new Delivery(
      input.transactionId,
      input.status,
      input.productId,
      input.productName,
      input.units,
      input.recipientName,
      input.recipientPhone,
      input.address,
      input.createdAt,
      input.estimatedDeliveryAt,
    );
  }

  /** Enough for the buyer to recognise the number, not enough to reuse it. */
  get maskedRecipientPhone(): string {
    return `${'*'.repeat(Math.max(this.recipientPhone.length - 4, 0))}${this.recipientPhone.slice(-4)}`;
  }
}

const addBusinessDays = (from: Date, days: number): Date => {
  const date = new Date(from);
  let added = 0;

  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      added += 1;
    }
  }

  return date;
};
