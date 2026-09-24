import { DomainError, UnexpectedFailure } from './domain-error';

class InsufficientStock extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK';
  readonly kind = 'CONFLICT' as const;
}

describe('DomainError', () => {
  it('carries a machine-readable code, a transport-agnostic kind and a message', () => {
    const error = new InsufficientStock('Only 2 units available');

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.kind).toBe('CONFLICT');
    expect(error.message).toBe('Only 2 units available');
    expect(error.details).toBeUndefined();
  });

  it('carries structured details when the caller needs them to act', () => {
    const error = new InsufficientStock('Only 2 units available', { requested: 5, available: 2 });

    expect(error.details).toEqual({ requested: 5, available: 2 });
  });
});

describe('UnexpectedFailure', () => {
  it('is classified as UNEXPECTED so the edge answers 500 rather than a business status', () => {
    const failure = new UnexpectedFailure('DynamoDB rejected the write');

    expect(failure.kind).toBe('UNEXPECTED');
    expect(failure.code).toBe('UNEXPECTED_FAILURE');
  });

  it('retains the original cause for logging', () => {
    const cause = new Error('ProvisionedThroughputExceededException');

    expect(new UnexpectedFailure('write failed', cause).cause).toBe(cause);
  });

  it('is a DomainError, so it can travel on the failure track like any other', () => {
    expect(new UnexpectedFailure('boom')).toBeInstanceOf(DomainError);
  });
});
