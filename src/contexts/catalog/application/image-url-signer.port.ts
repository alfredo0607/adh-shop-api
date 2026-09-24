/**
 * Turns the key of a stored product image into a URL a browser can load.
 *
 * Images live in a private bucket, so the address alone grants nothing: the
 * URL has to carry proof that this API issued it, and that proof expires. The
 * catalogue only knows the object key; how access is granted is the adapter's
 * business.
 */
export interface ImageUrlSigner {
  sign(imageKey: string): string;
}

export const IMAGE_URL_SIGNER = Symbol('ImageUrlSigner');
