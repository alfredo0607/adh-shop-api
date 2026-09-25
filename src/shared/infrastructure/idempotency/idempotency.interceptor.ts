import { createHash } from 'node:crypto';

import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import { type Observable, catchError, from, mergeMap, of, switchMap, throwError } from 'rxjs';

import { IDEMPOTENCY_STORE, type IdempotencyStore } from './idempotency.store';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

// Long enough to be unguessable by accident, short enough to index cheaply.
// A UUID v4 fits, which is what clients are expected to send.
const VALID_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Makes a route safe to retry.
 *
 * A mobile client that times out cannot tell whether its payment went
 * through, and it will retry. With a key, the retry receives the original
 * response instead of running the payment a second time.
 *
 * The key is bound to the request it was first used with — method, path and
 * body — so reusing it for something else is refused rather than answered
 * with an unrelated stored response. Only successful responses are stored: a
 * failure is abandoned, and the client may retry it under the same key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const key = request.header(IDEMPOTENCY_HEADER);

    if (key === undefined || !VALID_KEY.test(key)) {
      throw new BadRequestException(
        'An Idempotency-Key header (16 to 64 letters, digits, "-" or "_") is required',
      );
    }

    const fingerprint = createHash('sha256')
      .update(`${request.method} ${request.originalUrl} ${JSON.stringify(request.body ?? null)}`)
      .digest('hex');

    // Nest applies @HttpCode after the interceptors have run, so the status a
    // successful call will have is read from the route's metadata.
    const successStatus =
      (Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as number | undefined) ??
      HttpStatus.OK;

    return from(this.store.begin(key, fingerprint)).pipe(
      switchMap((begun) => {
        if (begun.outcome === 'REPLAY') {
          response.status(begun.statusCode);
          response.setHeader('Idempotent-Replayed', 'true');
          return of(begun.body);
        }

        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await this.store.complete(key, fingerprint, successStatus, body);
            return body;
          }),
          catchError((error: unknown) =>
            from(this.store.abandon(key).catch(() => undefined)).pipe(
              switchMap(() => throwError(() => error)),
            ),
          ),
        );
      }),
    );
  }
}
