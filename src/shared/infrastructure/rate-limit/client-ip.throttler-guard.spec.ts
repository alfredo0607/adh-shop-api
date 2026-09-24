import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { ClientIpThrottlerGuard } from './client-ip.throttler-guard';

type Guard = ClientIpThrottlerGuard & {
  getTracker(request: Request): Promise<string>;
  shouldSkip(context: ExecutionContext): Promise<boolean>;
};

const buildGuard = (): Guard => Object.create(ClientIpThrottlerGuard.prototype) as Guard;

const buildRequest = (overrides: Partial<Request> = {}): Request =>
  ({ socket: {}, path: '/api/v1/products', ...overrides }) as Request;

const buildContext = (request: Request): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as ExecutionContext;

describe('ClientIpThrottlerGuard', () => {
  describe('getTracker', () => {
    it('counts by the address Express derived, which honours the trusted hop count', async () => {
      const guard = buildGuard();

      await expect(guard.getTracker(buildRequest({ ip: '203.0.113.9' }))).resolves.toBe(
        '203.0.113.9',
      );
    });

    it('falls back to the socket address when Express has none', async () => {
      const guard = buildGuard();
      const request = buildRequest({ socket: { remoteAddress: '10.0.0.7' } as Request['socket'] });

      await expect(guard.getTracker(request)).resolves.toBe('10.0.0.7');
    });

    it('returns a constant rather than undefined when neither is available', async () => {
      const guard = buildGuard();

      // Returning undefined would make every such caller share one bucket,
      // which is the failure this guard exists to prevent.
      await expect(guard.getTracker(buildRequest())).resolves.toBe('unknown');
    });
  });

  describe('shouldSkip', () => {
    it.each(['/health', '/ready'])('exempts %s', async (path) => {
      const guard = buildGuard();

      await expect(guard.shouldSkip(buildContext(buildRequest({ path })))).resolves.toBe(true);
    });

    it('counts ordinary traffic', async () => {
      const guard = buildGuard();

      await expect(
        guard.shouldSkip(buildContext(buildRequest({ path: '/api/v1/products' }))),
      ).resolves.toBe(false);
    });

    it('does not exempt a path that merely contains the probe name', async () => {
      const guard = buildGuard();

      // A prefix match would let /api/v1/health-check bypass the limiter.
      await expect(
        guard.shouldSkip(buildContext(buildRequest({ path: '/api/v1/health-check' }))),
      ).resolves.toBe(false);
    });
  });
});
