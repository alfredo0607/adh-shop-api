import { randomUUID } from 'node:crypto';

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';
import type { Options } from 'pino-http';

import type { Environment } from '../config/environment';

/**
 * Header a load balancer or CDN uses to propagate a trace identifier. Honouring
 * an inbound value means a single request can be followed across the CDN, this
 * service and anything it calls; generating a fresh one per hop would break that
 * chain exactly when an incident makes it most valuable.
 */
const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Paths scrubbed from every log line.
 *
 * Configured centrally and deliberately: relying on each developer to remember
 * not to log a card token is relying on nobody ever forgetting. The wildcards
 * cover nested occurrences, since a gateway response can carry a token several
 * levels down.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.body.token',
  'req.body.cvc',
  'req.body.number',
  'res.headers["set-cookie"]',
  '*.token',
  '*.cvc',
  '*.card_number',
  '*.cardNumber',
  '*.privateKey',
  '*.secret',
  '*.password',
];

/**
 * Narrows `Params`, whose `pinoHttp` is a union that also admits a raw
 * destination stream. Declaring exactly what is built here lets the test assert
 * on the redaction list and the probe filter directly, instead of casting.
 */
export interface LoggerConfiguration extends Params {
  pinoHttp: Options & {
    genReqId: (request: IncomingMessage, response: ServerResponse) => string;
    redact: { paths: string[]; censor: string };
    autoLogging: { ignore: (request: IncomingMessage) => boolean };
  };
}

export const buildLoggerOptions = (environment: Environment): LoggerConfiguration => ({
  pinoHttp: {
    level: environment.LOG_LEVEL,

    genReqId: (request: IncomingMessage, response: ServerResponse): string => {
      const inbound = request.headers[REQUEST_ID_HEADER];
      const id = (Array.isArray(inbound) ? inbound[0] : inbound) ?? randomUUID();

      // Echoed back so a client can quote it in a bug report, and so the value
      // in the log and the value the user sees are the same string.
      response.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },

    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },

    // Human-readable locally; newline-delimited JSON when deployed, because log
    // aggregators parse structure and not colour codes.
    transport:
      environment.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
        : undefined,

    // Probes would otherwise dominate the log at one line per second.
    autoLogging: {
      ignore: (request: IncomingMessage): boolean =>
        request.url === '/health' || request.url === '/ready',
    },
  },
});
