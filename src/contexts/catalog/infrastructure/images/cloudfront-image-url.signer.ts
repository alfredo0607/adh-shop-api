import { getSignedUrl } from '@aws-sdk/cloudfront-signer';

import type { ClockPort } from '../../../../shared/domain/clock.port';
import type { ImageUrlSigner } from '../../application/image-url-signer.port';

export interface CloudFrontSignerOptions {
  readonly domain: string;
  readonly keyPairId: string;
  readonly privateKey: string;
  readonly ttlSeconds: number;
}

/**
 * Issues CloudFront signed URLs for product images.
 *
 * The expiry is aligned to a window rather than computed from "now". Signing
 * with now + ttl would give every response a different URL for the same image,
 * so the browser could never reuse what it already downloaded and the CDN
 * would see each request as new. Rounding down to the start of the current
 * window keeps the URL identical for everyone during that window, and adding
 * two windows guarantees at least one full ttl of validity left, even for a
 * URL issued in the last second of a window.
 */
export class CloudFrontImageUrlSigner implements ImageUrlSigner {
  constructor(
    private readonly options: CloudFrontSignerOptions,
    private readonly clock: ClockPort,
  ) {}

  sign(imageKey: string): string {
    const windowMs = this.options.ttlSeconds * 1000;
    const windowStart = Math.floor(this.clock.now().getTime() / windowMs) * windowMs;

    return getSignedUrl({
      url: `https://${this.options.domain}/${encodeURI(imageKey)}`,
      keyPairId: this.options.keyPairId,
      privateKey: this.options.privateKey,
      dateLessThan: new Date(windowStart + 2 * windowMs).toISOString(),
    });
  }
}

/**
 * Used when no CDN is configured, which is the case locally and in tests.
 *
 * Returns the key unchanged. The environment schema refuses to boot production
 * without the CDN settings, so this can never quietly serve unsigned URLs there.
 */
export class UnsignedImageUrlSigner implements ImageUrlSigner {
  sign(imageKey: string): string {
    return imageKey;
  }
}
