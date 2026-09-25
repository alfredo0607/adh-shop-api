import { Body, Controller, HttpCode, HttpStatus, Inject, Logger, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { DomainHttpException } from '../../../../shared/infrastructure/http/domain-http.exception';
// Value import: see the note in the catalogue's controller.
import { SettleTransaction } from '../../application/settle-transaction.usecase';
import { PaymentEventVerifier } from '../payment/payment-event.verifier';

export const PAYMENT_EVENT_VERIFIER = Symbol('PaymentEventVerifier');

/**
 * Receives the gateway's payment events.
 *
 * The status code is an instruction to the gateway, not a report to a user:
 * anything other than 2xx means "deliver this again". So an event that can
 * never succeed — a reference this service does not know, an amount that does
 * not match — is acknowledged and logged, while a transient failure such as an
 * unavailable store answers 503 to be retried. A forged event is refused.
 *
 * Left out of the public API documentation: it is a contract with the gateway,
 * not something the storefront calls.
 */
@ApiExcludeController()
@Controller({ version: '1' })
export class PaymentEventsController {
  private readonly logger = new Logger(PaymentEventsController.name);

  constructor(
    @Inject(PAYMENT_EVENT_VERIFIER) private readonly verifier: PaymentEventVerifier,
    private readonly settleTransaction: SettleTransaction,
  ) {}

  @Post('payment-events')
  @HttpCode(HttpStatus.OK)
  async receive(@Body() payload: unknown): Promise<{ received: true }> {
    const verified = this.verifier.verify(payload);

    if (verified.isErr()) {
      throw new DomainHttpException(verified.error);
    }

    const outcome = verified.value;
    if (outcome === undefined) {
      return { received: true };
    }

    const settled = await this.settleTransaction.execute(outcome);

    if (settled.isErr()) {
      const { error } = settled;

      if (error.kind !== 'NOT_FOUND' && error.kind !== 'CONFLICT') {
        throw new DomainHttpException(error);
      }

      this.logger.warn(
        `Payment event for ${outcome.reference} not applied: ${error.code} ${JSON.stringify(error.details ?? {})}`,
      );
    }

    return { received: true };
  }
}
