import { HttpStatus } from '@nestjs/common';

// Imported through the barrel, which keeps the public surface of the shared
// kernel exercised by the test suite.
import { DomainError, type ErrorKind, err, ok } from '../../domain';
import { DomainHttpException, statusForKind, toHttpResponse } from './domain-http.exception';

class TestError extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK';
  readonly kind = 'CONFLICT' as const;
}

describe('statusForKind', () => {
  it.each<[ErrorKind, HttpStatus]>([
    ['NOT_FOUND', HttpStatus.NOT_FOUND],
    ['CONFLICT', HttpStatus.CONFLICT],
    ['VALIDATION', HttpStatus.UNPROCESSABLE_ENTITY],
    ['UNAUTHORIZED', HttpStatus.UNAUTHORIZED],
    ['FORBIDDEN', HttpStatus.FORBIDDEN],
    ['UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE],
    ['UNEXPECTED', HttpStatus.INTERNAL_SERVER_ERROR],
  ])('maps %s to %i', (kind, expected) => {
    expect(statusForKind(kind)).toBe(expected);
  });
});

describe('DomainHttpException', () => {
  it('takes its status from the error kind and keeps the original error attached', () => {
    const domainError = new TestError('Only 2 units available', { available: 2 });

    const exception = new DomainHttpException(domainError);

    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(exception.message).toBe('Only 2 units available');
    expect(exception.domainError).toBe(domainError);
  });
});

describe('toHttpResponse', () => {
  it('returns the value on the happy path', () => {
    expect(toHttpResponse(ok<string, TestError>('product'))).toBe('product');
  });

  it('throws a DomainHttpException carrying the domain error on the failure path', () => {
    const domainError = new TestError('Only 2 units available');

    expect(() => toHttpResponse(err<TestError, string>(domainError))).toThrow(DomainHttpException);

    try {
      toHttpResponse(err<TestError, string>(domainError));
      fail('expected toHttpResponse to throw');
    } catch (error) {
      expect((error as DomainHttpException).domainError).toBe(domainError);
      expect((error as DomainHttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    }
  });
});
