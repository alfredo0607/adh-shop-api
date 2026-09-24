import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { DomainHttpException } from './domain-http.exception';

/** Any status at or above this is the server's fault, and therefore a defect. */
const SERVER_ERROR_THRESHOLD = 500;

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: Readonly<Record<string, unknown>> | undefined;
  };
  requestId: string;
}

/**
 * The defect boundary.
 *
 * The `Result` combinators deliberately do not catch, so that a throw stays a
 * defect rather than being silently reclassified as a business failure. This
 * filter is where those defects finally stop: they are logged in full, with the
 * request id, and answered with a generic 500 that reveals nothing.
 *
 * That asymmetry is the point. Internally an unexpected fault must be loud
 * enough to page someone; externally it must say nothing at all, because a
 * driver message like "ConditionalCheckFailedException on table adh-shop-prod,
 * key PRODUCT#7" hands an attacker the database engine, the table name and the
 * key schema.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request & { id?: string }>();
    const requestId = request.id ?? 'unknown';

    const { status, body } = this.describe(exception, requestId);

    if (status >= SERVER_ERROR_THRESHOLD) {
      // A defect: log the whole thing, including the stack, and keep it out of
      // the response.
      this.logger.error(
        `Unhandled failure on ${request.method} ${request.url} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private describe(
    exception: unknown,
    requestId: string,
  ): { status: number; body: ErrorResponseBody } {
    if (exception instanceof DomainHttpException) {
      const { domainError } = exception;

      return {
        status: exception.getStatus(),
        body: {
          error: {
            code: domainError.code,
            message: domainError.message,
            details: domainError.details,
          },
          requestId,
        },
      };
    }

    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        body: {
          error: {
            code: this.codeForStatus(exception.getStatus()),
            message: exception.message,
            details: this.detailsFrom(exception),
          },
          requestId,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          // Deliberately opaque. The detail is in the log, keyed by requestId.
          message: 'An unexpected error occurred',
        },
        requestId,
      },
    };
  }

  /**
   * Surfaces validation failures from `ValidationPipe`, whose response object
   * carries the per-field messages, while discarding anything else Nest may have
   * attached.
   */
  private detailsFrom(exception: HttpException): Record<string, unknown> | undefined {
    const response = exception.getResponse();

    if (typeof response !== 'object' || response === null) {
      return undefined;
    }

    const { message } = response as { message?: unknown };

    return Array.isArray(message) ? { fields: message } : undefined;
  }

  private codeForStatus(status: number): string {
    const codes: Readonly<Record<number, string>> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_FAILED',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
    };

    return codes[status] ?? 'ERROR';
  }
}
