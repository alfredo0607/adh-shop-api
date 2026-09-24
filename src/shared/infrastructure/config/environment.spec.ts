import { parseEnvironment } from './environment';

const validEnvironment = {
  AWS_REGION: 'us-east-1',
  DYNAMODB_TABLE_NAME: 'adh-shop-test',
  PAYMENT_API_URL: 'https://gateway.test/v1',
  PAYMENT_PUBLIC_KEY: 'public',
  PAYMENT_PRIVATE_KEY: 'private',
  PAYMENT_INTEGRITY_SECRET: 'integrity',
  PAYMENT_EVENTS_SECRET: 'events',
} satisfies NodeJS.ProcessEnv;

describe('parseEnvironment', () => {
  it('accepts a complete environment and applies defaults for optional keys', () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment.NODE_ENV).toBe('development');
    expect(environment.PORT).toBe(3000);
    expect(environment.LOG_LEVEL).toBe('info');
    expect(environment.PAYMENT_TIMEOUT_MS).toBe(10_000);
  });

  it('coerces numeric variables, since every environment variable arrives as a string', () => {
    const environment = parseEnvironment({ ...validEnvironment, PORT: '8080' });

    expect(environment.PORT).toBe(8080);
    expect(typeof environment.PORT).toBe('number');
  });

  it('reports every missing key at once rather than one per failed deploy', () => {
    expect(() => parseEnvironment({})).toThrow(/AWS_REGION/);

    try {
      parseEnvironment({});
      fail('expected parseEnvironment to throw');
    } catch (error) {
      const message = (error as Error).message;

      expect(message).toContain('AWS_REGION');
      expect(message).toContain('DYNAMODB_TABLE_NAME');
      expect(message).toContain('PAYMENT_PUBLIC_KEY');
      expect(message).toContain('PAYMENT_EVENTS_SECRET');
    }
  });

  it('rejects a payment endpoint that is not a URL', () => {
    expect(() => parseEnvironment({ ...validEnvironment, PAYMENT_API_URL: 'not-a-url' })).toThrow(
      /PAYMENT_API_URL/,
    );
  });

  it('rejects a port outside the valid range', () => {
    expect(() => parseEnvironment({ ...validEnvironment, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV instead of silently treating it as production', () => {
    expect(() => parseEnvironment({ ...validEnvironment, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('allows running without the image CDN outside production', () => {
    expect(parseEnvironment(validEnvironment).CDN_DOMAIN).toBeUndefined();
  });

  it('refuses to boot production without every image CDN setting, naming each one', () => {
    const attempt = (): unknown =>
      parseEnvironment({ ...validEnvironment, NODE_ENV: 'production', CDN_DOMAIN: 'cdn.test' });

    expect(attempt).toThrow(/CDN_KEY_PAIR_ID/);
    expect(attempt).toThrow(/CDN_PRIVATE_KEY_BASE64/);
  });

  it('treats the local DynamoDB endpoint as optional', () => {
    expect(parseEnvironment(validEnvironment).DYNAMODB_ENDPOINT).toBeUndefined();
    expect(
      parseEnvironment({ ...validEnvironment, DYNAMODB_ENDPOINT: 'http://localhost:8000' })
        .DYNAMODB_ENDPOINT,
    ).toBe('http://localhost:8000');
  });

  it('keeps fees as integers, because money must never be floating point', () => {
    const environment = parseEnvironment({ ...validEnvironment, BASE_FEE_IN_CENTS: '1500' });

    expect(environment.BASE_FEE_IN_CENTS).toBe(1500);
    expect(() => parseEnvironment({ ...validEnvironment, BASE_FEE_IN_CENTS: '15.5' })).toThrow(
      /BASE_FEE_IN_CENTS/,
    );
  });

  it('rejects a negative fee', () => {
    expect(() => parseEnvironment({ ...validEnvironment, DELIVERY_FEE_IN_CENTS: '-1' })).toThrow(
      /DELIVERY_FEE_IN_CENTS/,
    );
  });
});
