import { Logger } from '@nestjs/common';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

import type { PaymentEventsPort, PaymentSettled } from '../../domain/payment-events.port';
import { toPaymentSettledMessage } from './payment-settled.message';

/**
 * Sends payment events to the SQS queue the email Lambda consumes.
 *
 * Failure is logged and swallowed, as the port requires: the payment is
 * already stored, and the buyer's request must not fail because an email
 * could not be queued. The SDK retries transient errors before giving up.
 */
export class SqsPaymentEventsPublisher implements PaymentEventsPort {
  private readonly logger = new Logger(SqsPaymentEventsPublisher.name);

  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async settled(event: PaymentSettled): Promise<void> {
    const message = toPaymentSettledMessage(event);

    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(message),
          MessageAttributes: {
            type: { DataType: 'String', StringValue: message.type },
            version: { DataType: 'Number', StringValue: String(message.version) },
          },
        }),
      );
    } catch (error) {
      // The transaction id is enough to find the order and resend by hand.
      this.logger.error(
        `Could not queue the payment email for ${message.transactionId} (${message.status}): ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}
