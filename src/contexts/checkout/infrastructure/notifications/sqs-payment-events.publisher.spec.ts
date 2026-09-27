import { Logger } from '@nestjs/common';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

import { NOW, TOTAL_FOR_ONE, aTransaction } from '../../__fixtures__/checkout.fixture';
import { Delivery } from '../../domain/delivery';
import type { DeliveryAddress } from '../../domain/delivery-address';
import { toPaymentSettledMessage } from './payment-settled.message';
import { SqsPaymentEventsPublisher } from './sqs-payment-events.publisher';

const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/payment-notifications';
const SETTLED_AT = new Date('2026-09-24T18:05:00.000Z');

/** An approved transaction and the delivery settling it created. */
const approved = (): { transaction: ReturnType<typeof aTransaction>; delivery: Delivery } => {
  const claimed = aTransaction().claimPayment(NOW);
  if (claimed.isErr()) throw new Error('fixture claim failed');
  const settled = claimed.value
    .recordGatewayPayment('gw-1', NOW)
    .settle('APPROVED', SETTLED_AT, 'gw-1');
  if (settled === undefined) throw new Error('fixture did not settle');
  return { transaction: settled, delivery: Delivery.forApproved(settled, SETTLED_AT) };
};

describe('toPaymentSettledMessage', () => {
  it('describes an approved order: lines, amounts, address and estimated delivery', () => {
    const { transaction, delivery } = approved();

    expect(toPaymentSettledMessage({ transaction, delivery, occurredAt: SETTLED_AT })).toEqual({
      type: 'payment.settled',
      version: 1,
      transactionId: '6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60',
      status: 'APPROVED',
      occurredAt: '2026-09-24T18:05:00.000Z',
      customer: { fullName: 'Laura Gómez', email: 'laura@example.com' },
      lines: [
        {
          productId: 'prod-01',
          name: 'Cafetera',
          units: 1,
          unitPriceInCents: 150_000,
          lineTotalInCents: 150_000,
        },
      ],
      amounts: {
        productInCents: 150_000,
        baseFeeInCents: 500_00,
        deliveryFeeInCents: 1_200_00,
        totalInCents: TOTAL_FOR_ONE,
        currency: 'COP',
      },
      delivery: {
        addressLine1: 'Calle 93 # 11-26',
        addressLine2: 'Apartamento 502',
        city: 'Bogotá',
        region: 'Cundinamarca',
        postalCode: '110221',
        country: 'CO',
        estimatedDeliveryAt: delivery.estimatedDeliveryAt.toISOString(),
      },
    });
  });

  it('leaves out the address lines the buyer did not give', () => {
    const transaction = aTransaction();
    jest.spyOn(transaction, 'deliveryAddress', 'get').mockReturnValue({
      addressLine1: 'Calle 1 # 2-3',
      city: 'Cali',
      region: 'Valle del Cauca',
      country: 'CO',
    } as DeliveryAddress);

    const message = toPaymentSettledMessage({ transaction, occurredAt: SETTLED_AT });

    expect(message.delivery).toEqual({
      addressLine1: 'Calle 1 # 2-3',
      city: 'Cali',
      region: 'Valle del Cauca',
      country: 'CO',
    });
  });

  it('leaves out the delivery date when nothing will be delivered, and never the phone', () => {
    const message = toPaymentSettledMessage({
      transaction: aTransaction(),
      occurredAt: SETTLED_AT,
    });

    expect(message.delivery).not.toHaveProperty('estimatedDeliveryAt');
    expect(JSON.stringify(message)).not.toContain('3001234567');
  });
});

describe('SqsPaymentEventsPublisher', () => {
  type Send = jest.Mock<Promise<unknown>, [SendMessageCommand]>;
  const clientSending = (send: Send): SQSClient => ({ send }) as unknown as SQSClient;

  it('sends the message to the queue, typed and versioned', async () => {
    const send: Send = jest.fn().mockResolvedValue({ MessageId: 'm-1' });
    const { transaction, delivery } = approved();

    await new SqsPaymentEventsPublisher(clientSending(send), QUEUE_URL).settled({
      transaction,
      delivery,
      occurredAt: SETTLED_AT,
    });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(SendMessageCommand);
    if (command === undefined) throw new Error('nothing was sent');
    expect(command.input.QueueUrl).toBe(QUEUE_URL);
    expect(JSON.parse(command.input.MessageBody ?? '')).toEqual(
      toPaymentSettledMessage({ transaction, delivery, occurredAt: SETTLED_AT }),
    );
    expect(command.input.MessageAttributes).toEqual({
      type: { DataType: 'String', StringValue: 'payment.settled' },
      version: { DataType: 'Number', StringValue: '1' },
    });
  });

  it('logs and resolves when the queue refuses, so the payment is unaffected', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const send: Send = jest.fn().mockRejectedValue(new Error('AccessDenied'));

    await expect(
      new SqsPaymentEventsPublisher(clientSending(send), QUEUE_URL).settled({
        transaction: aTransaction(),
        occurredAt: SETTLED_AT,
      }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('6f1c2b9e-8f4a-4d7e-9a51-1b2c3d4e5f60'),
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining('AccessDenied'));
    error.mockRestore();
  });

  it('logs whatever was thrown, even when it is not an Error', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const send: Send = jest.fn().mockRejectedValue('socket hang up');

    await new SqsPaymentEventsPublisher(clientSending(send), QUEUE_URL).settled({
      transaction: aTransaction(),
      occurredAt: SETTLED_AT,
    });

    expect(error).toHaveBeenCalledWith(expect.stringContaining('socket hang up'));
    error.mockRestore();
  });
});
