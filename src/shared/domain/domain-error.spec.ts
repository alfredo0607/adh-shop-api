import { DomainError, UnexpectedFailure, describeCause } from './domain-error';

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

describe('describeCause', () => {
  it('renders nothing when there is no cause', () => {
    expect(describeCause(undefined)).toBe('');
    expect(describeCause(null)).toBe('');
  });

  it('renders an Error with its stack, which is where the location is', () => {
    const rendered = describeCause(new Error('ECONNRESET'));

    expect(rendered).toContain('ECONNRESET');
    expect(rendered).toContain('at ');
  });

  it('follows the chain to the sentence that actually explains the failure', () => {
    const socket = new Error('ECONNRESET');
    const sdk = new Error('ProvisionedThroughputExceeded', { cause: socket });

    const rendered = describeCause(new UnexpectedFailure('write failed', sdk));

    // The outermost message is true and useless on its own.
    expect(rendered).toContain('write failed');
    expect(rendered).toContain('ProvisionedThroughputExceeded');
    expect(rendered).toContain('ECONNRESET');
  });

  it('renders a nested domain error by code and message', () => {
    const inner = new UnexpectedFailure('inner failure');

    const rendered = describeCause(new UnexpectedFailure('outer failure', inner));

    expect(rendered).toContain('UNEXPECTED_FAILURE: outer failure');
    expect(rendered).toContain('caused by');
    expect(rendered).toContain('inner failure');
  });

  it('stops following a circular chain instead of never returning', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;

    const rendered = describeCause(a);

    expect(rendered).toContain('truncated');
  });

  it('serialises a plain object rather than printing [object Object]', () => {
    const rendered = describeCause({ name: 'AccessDenied', statusCode: 403 });

    // An SDK error that is not an Error instance still carries what identifies
    // it, and that is exactly the case this function exists to keep readable.
    expect(rendered).toContain('AccessDenied');
    expect(rendered).toContain('403');
  });

  it('survives an object that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(describeCause(circular)).toContain('could not be serialised');
  });

  it.each([
    ['a string cause', 'socket closed', 'socket closed'],
    ['a numeric cause', 500, '500'],
  ])('renders %s', (_label, cause, expected) => {
    expect(describeCause(cause)).toBe(expected);
  });
});
