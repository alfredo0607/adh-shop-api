import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';

/** Swagger UI runs its own scripts and styles; everything else is JSON. */
const DOCS_PATH = '/api/docs';

/**
 * Every security header the API sends, from one place.
 *
 * nginx in front of the container adds none of these. Two layers each setting
 * them produced duplicated headers, and once a contradictory pair
 * (`X-Frame-Options: SAMEORIGIN` and `DENY`), which a browser may resolve
 * either way.
 *
 * The JSON responses carry the Content-Security-Policy OWASP recommends for
 * APIs: nothing may load, and nothing may frame them. It matters little to a
 * browser reading JSON, but it closes the case where a response is opened as
 * a page. Swagger UI is exempt, because it is a page and needs its scripts.
 */
export const securityHeaders = (): RequestHandler[] => {
  const common = helmet({
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  const jsonPolicy = helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  });

  return [
    common,
    (request: Request, response: Response, next: NextFunction): void => {
      if (request.path.startsWith(DOCS_PATH)) {
        next();
        return;
      }
      jsonPolicy(request, response, next);
    },
  ];
};
