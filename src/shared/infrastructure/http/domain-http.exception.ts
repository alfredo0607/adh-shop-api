import { HttpException, HttpStatus } from '@nestjs/common';

import type { DomainError, ErrorKind } from '../../domain/domain-error';
import type { Result } from '../../domain/result';

/**
 * Maps the domain's transport-agnostic error kinds onto HTTP status codes.
 *
 * This table is the only place in the service that knows both vocabularies, and
 * it lives in the HTTP adapter precisely so the domain does not have to.
 *
 * `UNEXPECTED` maps to 500 because an adapter fault is the server's problem, not
 * the caller's. Note that a declined payment is deliberately NOT represented
 * here: a declined card is a successful request whose business outcome happens
 * to be failure, so it is returned as a normal response body, not as an error.
 */
const STATUS_BY_KIND: Readonly<Record<ErrorKind, HttpStatus>> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  VALIDATION: HttpStatus.UNPROCESSABLE_ENTITY,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  UNEXPECTED: HttpStatus.INTERNAL_SERVER_ERROR,
};

export const statusForKind = (kind: ErrorKind): HttpStatus => STATUS_BY_KIND[kind];

/**
 * Carries a `DomainError` across the boundary between the railway and the
 * framework.
 *
 * Throwing here is not a contradiction of Railway Oriented Programming: the
 * domain still never throws. This happens in the adapter, once the result has
 * already been inspected, because raising an exception is how a Nest controller
 * expresses a non-2xx response. The exception filter unwraps it again.
 */
export class DomainHttpException extends HttpException {
  constructor(readonly domainError: DomainError) {
    super(domainError.message, statusForKind(domainError.kind));
  }
}

/**
 * Unwraps a use case result for a controller.
 *
 * Keeps controllers to a single line and guarantees that every failure leaves
 * through the same path, so error responses cannot drift in shape between
 * endpoints:
 *
 *   return toHttpResponse(await this.findProduct.execute(id));
 */
export const toHttpResponse = <T, E extends DomainError>(result: Result<T, E>): T =>
  result.match({
    ok: (value) => value,
    err: (error) => {
      throw new DomainHttpException(error);
    },
  });
