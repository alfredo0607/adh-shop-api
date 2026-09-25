import {
  type ClockPort,
  type IdGeneratorPort,
  ResultAsync,
  combine,
  err,
  ok,
  type Result,
} from '../../../shared/domain';
import {
  AmountMismatch,
  type CheckoutUnavailable,
  type InvalidCustomer,
  type InvalidDeliveryAddress,
  type InvalidTransaction,
  type OutOfStock,
  type UnknownProduct,
} from '../domain/checkout.errors';
import { Customer, type CustomerDetails } from '../domain/customer';
import type { CustomerRepository } from '../domain/customer.repository';
import { DeliveryAddress, type DeliveryAddressInput } from '../domain/delivery-address';
import type { InventoryPort, ProductOffer } from '../domain/inventory.port';
import { type Fees, Quote } from '../domain/quote';
import { Transaction } from '../domain/transaction';
import type { TransactionRepository } from '../domain/transaction.repository';

export interface CreateTransactionCommand {
  readonly productId: string;
  readonly units: number;
  readonly customer: CustomerDetails;
  readonly deliveryAddress: DeliveryAddressInput;
  /** The total the buyer saw on the summary screen. */
  readonly expectedTotalInCents: number;
}

export type CreateTransactionError =
  | InvalidCustomer
  | InvalidDeliveryAddress
  | InvalidTransaction
  | AmountMismatch
  | UnknownProduct
  | OutOfStock
  | CheckoutUnavailable;

export interface CheckoutPolicy {
  readonly fees: Fees;
  /** How long reserved units wait for a payment before returning to the shelf. */
  readonly reservationTtlMs: number;
}

interface ValidatedInput {
  readonly customer: CustomerDetails;
  readonly deliveryAddress: DeliveryAddress;
}

/**
 * Opens a PENDING transaction holding reserved stock.
 *
 * Everything that can be rejected without touching the store is rejected
 * first, so a malformed request never reserves anything. From the moment units
 * are reserved, any later failure hands them back before reporting: an order
 * that failed to be written must not leave stock held for nobody.
 */
export class CreateTransaction {
  constructor(
    private readonly inventory: InventoryPort,
    private readonly customers: CustomerRepository,
    private readonly transactions: TransactionRepository,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly policy: CheckoutPolicy,
  ) {}

  execute(command: CreateTransactionCommand): ResultAsync<Transaction, CreateTransactionError> {
    return ResultAsync.fromResult(this.validate(command)).andThen((input) =>
      this.inventory
        .reserve(command.productId, command.units)
        // Compensation is chained onto what follows a successful reservation,
        // not onto the reservation itself: a failed reservation holds nothing,
        // and releasing units it never took would hand out someone else's.
        .andThen((offer) =>
          this.place(command, input, offer).orElse((error) =>
            this.releaseReservation(command, error),
          ),
        ),
    );
  }

  private validate(
    command: CreateTransactionCommand,
  ): Result<ValidatedInput, CreateTransactionError> {
    const checks = combine<unknown, CreateTransactionError>([
      Quote.checkUnits(command.units),
      Customer.details(command.customer),
      DeliveryAddress.create(command.deliveryAddress),
    ]);

    if (checks.isErr()) {
      return err(checks.error);
    }

    const [, customer, deliveryAddress] = checks.value as [
      number,
      CustomerDetails,
      DeliveryAddress,
    ];

    return ok({ customer, deliveryAddress });
  }

  private place(
    command: CreateTransactionCommand,
    input: ValidatedInput,
    offer: ProductOffer,
  ): ResultAsync<Transaction, CreateTransactionError> {
    const quote = Quote.calculate({
      unitPriceInCents: offer.unitPriceInCents,
      units: command.units,
      currency: offer.currency,
      fees: this.policy.fees,
    }).andThen((computed): Result<Quote, CreateTransactionError> =>
      computed.totalInCents === command.expectedTotalInCents
        ? ok(computed)
        : err(new AmountMismatch(command.expectedTotalInCents, computed.totalInCents)),
    );

    return ResultAsync.fromResult(quote).andThen((checked) =>
      this.customers.register(input.customer, this.ids.generate()).andThen((customer) =>
        this.transactions.create(
          Transaction.open({
            id: this.ids.generate(),
            product: { id: offer.productId, name: offer.name },
            quote: checked,
            customer,
            deliveryAddress: input.deliveryAddress,
            now: this.clock.now(),
            reservationTtlMs: this.policy.reservationTtlMs,
          }),
        ),
      ),
    );
  }

  /**
   * Returns held units after a failure, then reports that failure.
   *
   * If the release itself fails, the original error is still the one reported:
   * it is what the buyer needs to know, and the units come back on their own
   * when the reservation expires.
   */
  private releaseReservation(
    command: CreateTransactionCommand,
    error: CreateTransactionError,
  ): ResultAsync<Transaction, CreateTransactionError> {
    return this.inventory
      .release(command.productId, command.units)
      .orElse(() => ok<void, never>(undefined))
      .andThen(() => err<CreateTransactionError, Transaction>(error));
  }
}
