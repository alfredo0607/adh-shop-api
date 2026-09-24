import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { DomainError } from '../../domain';
import { AllExceptionsFilter, type ErrorResponseBody } from './all-exceptions.filter';
import { DomainHttpException } from './domain-http.exception';

class OutOfStock extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK';
  readonly kind = 'CONFLICT' as const;
}

const REQUEST_ID = '01JC-test-request';

interface Captured {
  status: number;
  body: ErrorResponseBody;
}

interface ResponseStub {
  status(code: number): ResponseStub;
  json(body: ErrorResponseBody): ResponseStub;
}

interface Stub {
  host: ArgumentsHost;
  captured: Captured;
}

const buildHost = (request: Record<string, unknown> = {}): Stub => {
  const captured: Captured = { status: 0, body: {} as ErrorResponseBody };

  const response: ResponseStub = {
    status(code: number): ResponseStub {
      captured.status = code;
      return response;
    },
    json(body: ErrorResponseBody): ResponseStub {
      captured.body = body;
      return response;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: (): ResponseStub => response,
      getRequest: (): Record<string, unknown> => ({
        id: REQUEST_ID,
        method: 'POST',
        url: '/api/v1/transactions',
        ...request,
      }),
    }),
  } as unknown as ArgumentsHost;

  return { host, captured };
};

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('domain errors', () => {
    it('answers with the code, message and details of the domain error', () => {
      const { host, captured } = buildHost();

      filter.catch(
        new DomainHttpException(new OutOfStock('Only 2 units available', { available: 2 })),
        host,
      );

      expect(captured.status).toBe(HttpStatus.CONFLICT);
      expect(captured.body).toEqual({
        error: {
          code: 'INSUFFICIENT_STOCK',
          message: 'Only 2 units available',
          details: { available: 2 },
        },
        requestId: REQUEST_ID,
      });
    });

    it('does not log a business failure as an error, since it is an expected outcome', () => {
      const { host } = buildHost();

      filter.catch(new DomainHttpException(new OutOfStock('Only 2 units available')), host);

      expect(errorLog).not.toHaveBeenCalled();
    });
  });

  describe('framework exceptions', () => {
    it('translates a 404 into the shared error envelope', () => {
      const { host, captured } = buildHost();

      filter.catch(new NotFoundException('Cannot GET /api/v1/nope'), host);

      expect(captured.status).toBe(HttpStatus.NOT_FOUND);
      expect(captured.body.error.code).toBe('NOT_FOUND');
      expect(captured.body.requestId).toBe(REQUEST_ID);
    });

    it('surfaces per-field messages produced by ValidationPipe', () => {
      const { host, captured } = buildHost();

      filter.catch(
        new BadRequestException({
          message: ['number must be a valid card number', 'cvc must be 3 digits'],
        }),
        host,
      );

      expect(captured.body.error.details).toEqual({
        fields: ['number must be a valid card number', 'cvc must be 3 digits'],
      });
    });

    it('omits details when the exception carries no field messages', () => {
      const { host, captured } = buildHost();

      filter.catch(new HttpException('plain string payload', HttpStatus.FORBIDDEN), host);

      expect(captured.body.error.code).toBe('FORBIDDEN');
      expect(captured.body.error.details).toBeUndefined();
    });

    it('falls back to a generic code for a status with no specific mapping', () => {
      const { host, captured } = buildHost();

      filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), host);

      expect(captured.body.error.code).toBe('ERROR');
    });
  });

  describe('defects', () => {
    it('answers 500 with an opaque message, leaking nothing about internals', () => {
      const { host, captured } = buildHost();

      filter.catch(
        new Error('ConditionalCheckFailedException on table adh-shop-prod, key PRODUCT#7'),
        host,
      );

      expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(captured.body.error.code).toBe('INTERNAL_ERROR');
      expect(captured.body.error.message).toBe('An unexpected error occurred');

      // The whole point: the table name and key schema must not reach the client.
      expect(JSON.stringify(captured.body)).not.toContain('adh-shop-prod');
      expect(JSON.stringify(captured.body)).not.toContain('PRODUCT#7');
    });

    it('logs the defect in full, with the request id, so it can be investigated', () => {
      const { host } = buildHost();
      const defect = new Error('boom');

      filter.catch(defect, host);

      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(REQUEST_ID),
        expect.stringContaining('boom'),
      );
    });

    it('handles a thrown non-Error value without itself crashing', () => {
      const { host, captured } = buildHost();

      filter.catch('a bare string was thrown', host);

      expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(errorLog).toHaveBeenCalledWith(expect.any(String), 'a bare string was thrown');
    });
  });

  it('falls back to a placeholder when no request id is present', () => {
    const { host, captured } = buildHost({ id: undefined });

    filter.catch(new NotFoundException(), host);

    expect(captured.body.requestId).toBe('unknown');
  });
});

describe('AllExceptionsFilter cause reporting', () => {
  let filter: AllExceptionsFilter;
  let errorLog: jest.SpyInstance;

  class StoreUnavailable extends DomainError {
    readonly code = 'CATALOG_UNAVAILABLE';
    readonly kind = 'UNAVAILABLE' as const;
  }

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('logs the underlying cause, not only the translated message', () => {
    const { host } = buildHost();
    const cause = new Error('The security token included in the request is invalid');

    filter.catch(
      new DomainHttpException(
        new StoreUnavailable('Could not read the catalogue', undefined, cause),
      ),
      host,
    );

    // "Could not read the catalogue" is true and tells an operator nothing.
    // Diagnosing a missing container credential took far longer than it should
    // have because this line was absent.
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('CATALOG_UNAVAILABLE'),
      expect.stringContaining('security token'),
    );
  });

  it('says so explicitly when an adapter recorded no cause', () => {
    const { host } = buildHost();

    filter.catch(
      new DomainHttpException(new StoreUnavailable('Could not read the catalogue')),
      host,
    );

    // Silence would be ambiguous: no cause looks the same as a cause that was
    // dropped on the way.
    expect(errorLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('no underlying cause recorded'),
    );
  });

  it('never puts the cause in the response', () => {
    const { host, captured } = buildHost();
    const cause = new Error('table adh-shop-store, key PRODUCT#7, role adh-shop-container-host');

    filter.catch(
      new DomainHttpException(
        new StoreUnavailable('Could not read the catalogue', undefined, cause),
      ),
      host,
    );

    const serialised = JSON.stringify(captured.body);
    expect(serialised).not.toContain('adh-shop-store');
    expect(serialised).not.toContain('PRODUCT#7');
    expect(serialised).not.toContain('role');
  });

  it('stays quiet for a business failure, which is an expected outcome', () => {
    const { host } = buildHost();

    filter.catch(new DomainHttpException(new OutOfStock('Only 2 units available')), host);

    // Logging these at error level is how an error log becomes noise nobody
    // reads.
    expect(errorLog).not.toHaveBeenCalled();
  });
});
