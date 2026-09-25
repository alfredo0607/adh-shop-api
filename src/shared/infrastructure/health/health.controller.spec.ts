import { ServiceUnavailableException } from '@nestjs/common';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import type { Environment } from '../config/environment';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const environment = { DYNAMODB_TABLE_NAME: 'adh-shop-test' } as Environment;

  const controllerWith = (send: jest.Mock): { controller: HealthController; send: jest.Mock } => ({
    controller: new HealthController({ send } as unknown as DynamoDBDocumentClient, environment),
    send,
  });

  it('reports liveness without touching any dependency', () => {
    const { controller, send } = controllerWith(jest.fn());

    expect(controller.live()).toEqual({ status: 'ok' });
    expect(send).not.toHaveBeenCalled();
  });

  it('is ready when the table answers, even with nothing found', async () => {
    const { controller, send } = controllerWith(jest.fn().mockResolvedValue({}));

    await expect(controller.ready()).resolves.toEqual({ status: 'ok' });

    const [command, options] = send.mock.calls[0] as [
      { input: unknown },
      { abortSignal: AbortSignal },
    ];
    expect(command.input).toMatchObject({
      TableName: 'adh-shop-test',
      Key: { PK: 'READINESS#probe', SK: '#PROBE' },
    });
    // Bounded, so a hanging store fails the probe instead of stalling it.
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('is not ready when the table cannot be read', async () => {
    const denied = new Error('AccessDeniedException');
    const { controller } = controllerWith(jest.fn().mockRejectedValue(denied));

    const attempt = controller.ready();

    await expect(attempt).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(attempt).rejects.toMatchObject({ cause: denied });
  });
});
