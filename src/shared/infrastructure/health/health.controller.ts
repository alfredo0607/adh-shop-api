import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
  Version,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { ENVIRONMENT, type Environment } from '../config/environment';
import { DYNAMODB_CLIENT } from '../persistence/dynamodb.provider';

/** Long enough for a healthy round trip, short enough that a probe never piles up. */
export const READINESS_TIMEOUT_MS = 2_000;

/**
 * Liveness and readiness probes.
 *
 * Deliberately split. Liveness answers "is this process alive?" — if it fails,
 * the orchestrator restarts the container. Readiness answers "should traffic be
 * routed here?" — if it fails, the container is removed from the pool but left
 * running. Collapsing the two into one endpoint means a transient dependency
 * outage triggers a restart loop instead of a brief drain.
 *
 * Excluded from the public API document: these exist for infrastructure, not
 * for clients.
 */
@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(
    @Inject(DYNAMODB_CLIENT) private readonly dynamo: DynamoDBDocumentClient,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  @Version(VERSION_NEUTRAL)
  @Get('health')
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Ready only if the table answers. Every endpoint but the probes needs it, so
   * a container that cannot reach it — a missing permission, a wrong table
   * name — would answer every request with 503 while the working one it
   * replaced was retired.
   *
   * A read of a key that never exists: a miss proves the table is reachable
   * and the role may read it, costs half a read unit, and needs no permission
   * beyond the ones the application already uses. The rate-limit cache is not
   * checked: the limiter fails open by design, so serving without it is a
   * decision already taken, not an outage.
   */
  @Version(VERSION_NEUTRAL)
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.dynamo.send(
        new GetCommand({
          TableName: this.environment.DYNAMODB_TABLE_NAME,
          Key: { PK: 'READINESS#probe', SK: '#PROBE' },
        }),
        { abortSignal: AbortSignal.timeout(READINESS_TIMEOUT_MS) },
      );
    } catch (cause) {
      // The exception filter logs 5xx with this cause, so a failed deployment
      // says why in its own log.
      throw new ServiceUnavailableException('The data store is not reachable', { cause });
    }

    return { status: 'ok' };
  }
}
