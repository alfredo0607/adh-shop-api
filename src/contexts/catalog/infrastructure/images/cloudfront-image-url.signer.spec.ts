import { generateKeyPairSync } from 'node:crypto';

import type { ClockPort } from '../../../../shared/domain/clock.port';
import { CloudFrontImageUrlSigner, UnsignedImageUrlSigner } from './cloudfront-image-url.signer';

describe('CloudFrontImageUrlSigner', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const HOUR = 3600;
  const WINDOW_START = Date.UTC(2026, 8, 24, 10, 0, 0);

  const clockAt = (time: number): ClockPort => ({ now: () => new Date(time) });

  const signerAt = (time: number): CloudFrontImageUrlSigner =>
    new CloudFrontImageUrlSigner(
      { domain: 'cdn.test', keyPairId: 'K2TESTKEY', privateKey, ttlSeconds: HOUR },
      clockAt(time),
    );

  const expiresOf = (url: string): number => Number(new URL(url).searchParams.get('Expires'));

  it('points at the object on the CDN domain and carries the CloudFront parameters', () => {
    const url = new URL(signerAt(WINDOW_START).sign('product/prod-beans-06.webp'));

    expect(url.origin).toBe('https://cdn.test');
    expect(url.pathname).toBe('/product/prod-beans-06.webp');
    expect(url.searchParams.get('Key-Pair-Id')).toBe('K2TESTKEY');
    expect(url.searchParams.get('Signature')).toBeTruthy();
  });

  it('issues the same URL throughout a window, so browsers and the CDN can cache the image', () => {
    const early = signerAt(WINDOW_START + 1_000).sign('product/a.webp');
    const late = signerAt(WINDOW_START + HOUR * 1000 - 1_000).sign('product/a.webp');

    expect(late).toBe(early);
  });

  it('leaves at least one full ttl of validity, even when issued at the end of a window', () => {
    const issuedAt = WINDOW_START + HOUR * 1000 - 1_000;

    const remainingSeconds = expiresOf(signerAt(issuedAt).sign('product/a.webp')) - issuedAt / 1000;

    expect(remainingSeconds).toBeGreaterThanOrEqual(HOUR);
    expect(remainingSeconds).toBeLessThanOrEqual(2 * HOUR);
  });

  it('issues a new URL once the window rolls over', () => {
    const before = signerAt(WINDOW_START + 1_000).sign('product/a.webp');
    const after = signerAt(WINDOW_START + HOUR * 1000 + 1_000).sign('product/a.webp');

    expect(expiresOf(after)).toBe(expiresOf(before) + HOUR);
  });

  it('encodes keys that are not URL-safe', () => {
    const url = signerAt(WINDOW_START).sign('product/café grinder.webp');

    expect(new URL(url).pathname).toBe('/product/caf%C3%A9%20grinder.webp');
  });
});

describe('UnsignedImageUrlSigner', () => {
  it('returns the key unchanged', () => {
    expect(new UnsignedImageUrlSigner().sign('product/a.webp')).toBe('product/a.webp');
  });
});
