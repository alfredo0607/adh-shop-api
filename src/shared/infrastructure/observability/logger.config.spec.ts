import type { IncomingMessage, ServerResponse } from 'node:http';

import { parseEnvironment, type Environment } from '../config/environment';
import { buildLoggerOptions } from './logger.config';

const environmentWith = (overrides: NodeJS.ProcessEnv = {}): Environment =>
  parseEnvironment({
    AWS_REGION: 'us-east-1',
    DYNAMODB_TABLE_NAME: 'adh-shop-test',
    PAYMENT_API_URL: 'https://gateway.test/v1',
    PAYMENT_PUBLIC_KEY: 'public',
    PAYMENT_PRIVATE_KEY: 'private',
    PAYMENT_INTEGRITY_SECRET: 'integrity',
    PAYMENT_EVENTS_SECRET: 'events',
    CDN_DOMAIN: 'cdn.test',
    CDN_KEY_PAIR_ID: 'K2TESTKEY',
    CDN_PRIVATE_KEY_BASE64: 'cGVt',
    ...overrides,
  });

const buildRequest = (
  headers: IncomingMessage['headers'] = {},
  url = '/api/v1/products',
): IncomingMessage => ({ headers, url }) as IncomingMessage;

const buildResponse = (): { response: ServerResponse; headers: Record<string, unknown> } => {
  const headers: Record<string, unknown> = {};
  const response = {
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
    },
  } as unknown as ServerResponse;

  return { response, headers };
};

describe('buildLoggerOptions', () => {
  describe('request correlation', () => {
    it('honours an inbound x-request-id so a trace survives across hops', () => {
      const { pinoHttp } = buildLoggerOptions(environmentWith());
      const { response, headers } = buildResponse();

      const id = pinoHttp.genReqId(buildRequest({ 'x-request-id': 'from-the-cdn' }), response);

      expect(id).toBe('from-the-cdn');
      expect(headers['x-request-id']).toBe('from-the-cdn');
    });

    it('generates an id when the caller supplies none', () => {
      const { pinoHttp } = buildLoggerOptions(environmentWith());
      const { response, headers } = buildResponse();

      const id = pinoHttp.genReqId(buildRequest(), response);

      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(headers['x-request-id']).toBe(id);
    });

    it('takes the first value when the header arrives repeated', () => {
      const { pinoHttp } = buildLoggerOptions(environmentWith());
      const { response } = buildResponse();

      const id = pinoHttp.genReqId(buildRequest({ 'x-request-id': ['first', 'second'] }), response);

      expect(id).toBe('first');
    });
  });

  describe('redaction', () => {
    it('scrubs the paths through which a secret could reach a log', () => {
      const { pinoHttp } = buildLoggerOptions(environmentWith());
      const paths = pinoHttp.redact.paths;

      expect(paths).toContain('req.headers.authorization');
      expect(paths).toContain('req.body.number');
      expect(paths).toContain('req.body.cvc');
      expect(paths).toContain('*.token');
      expect(paths).toContain('*.privateKey');
      expect(paths).toContain('*.password');
      expect(pinoHttp.redact.censor).toBe('[redacted]');
    });
  });

  describe('probe noise', () => {
    it.each(['/health', '/ready'])('does not log %s, which runs once a second', (url) => {
      const { pinoHttp } = buildLoggerOptions(environmentWith());

      expect(pinoHttp.autoLogging.ignore(buildRequest({}, url))).toBe(true);
    });

    it('logs ordinary traffic', () => {
      const { pinoHttp } = buildLoggerOptions(environmentWith());

      expect(pinoHttp.autoLogging.ignore(buildRequest({}, '/api/v1/products'))).toBe(false);
    });
  });

  describe('transport', () => {
    it('pretty-prints in development, where a human reads the output', () => {
      const { pinoHttp } = buildLoggerOptions(environmentWith({ NODE_ENV: 'development' }));

      expect(pinoHttp.transport).toEqual({
        target: 'pino-pretty',
        options: { singleLine: true, translateTime: 'HH:MM:ss' },
      });
    });

    it('emits raw JSON in production, where a log aggregator parses it', () => {
      const { pinoHttp } = buildLoggerOptions(environmentWith({ NODE_ENV: 'production' }));

      expect(pinoHttp.transport).toBeUndefined();
    });

    it('takes the level from configuration', () => {
      const { pinoHttp } = buildLoggerOptions(environmentWith({ LOG_LEVEL: 'debug' }));

      expect(pinoHttp.level).toBe('debug');
    });
  });
});
