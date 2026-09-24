import { Controller, Get, HttpCode, HttpStatus, VERSION_NEUTRAL, Version } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

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
  @Version(VERSION_NEUTRAL)
  @Get('health')
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Version(VERSION_NEUTRAL)
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  ready(): { status: 'ok' } {
    // Once adapters exist this will verify them. Returning a hardcoded 'ok'
    // while claiming to check dependencies would be worse than not checking.
    return { status: 'ok' };
  }
}
