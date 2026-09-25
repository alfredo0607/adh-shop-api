import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate limits by the caller's address rather than by whoever last forwarded
 * the request.
 *
 * Behind Cloudflare and nginx, the socket's remote address is the proxy, not
 * the client. Counting that address puts every caller in the world into a
 * single bucket: the limit is reached almost immediately and then everyone is
 * blocked, so a rate limiter meant to prevent denial of service becomes the
 * mechanism for it.
 *
 * `req.ip` is only trustworthy once Express has been told how many hops to
 * trust, which main.ts does from TRUST_PROXY_HOPS. Express then walks
 * X-Forwarded-For from the right and discards exactly that many entries, which
 * is what stops a client forging the header to appear as a fresh address on
 * every request. The header is attacker-controlled up to the first trusted
 * proxy; the hop count is what decides where that line falls.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Request): Promise<string> {
    return Promise.resolve(request.ip ?? request.socket.remoteAddress ?? 'unknown');
  }

  /**
   * Probes are exempt.
   *
   * A load balancer polls /health once a second from a single address. Counting
   * that traffic would exhaust the limit on its own and then block the probe,
   * which the orchestrator reads as an unhealthy instance and replaces — a
   * restart loop caused entirely by the rate limiter.
   */
  protected override shouldSkip(
    context: Parameters<ThrottlerGuard['shouldSkip']>[0],
  ): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path;

    return Promise.resolve(path === '/health' || path === '/ready');
  }
}
