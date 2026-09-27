import express from 'express';
import request from 'supertest';

import { securityHeaders } from './security-headers';

describe('securityHeaders', () => {
  const app = express();
  app.use(...securityHeaders());
  app.get('/api/v1/products', (_request, response) => {
    response.json({ items: [] });
  });
  app.get('/api/docs', (_request, response) => {
    response.send('<html></html>');
  });

  it('sends each header once, with one value', async () => {
    const response = await request(app).get('/api/v1/products');

    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(response.headers['strict-transport-security']).toMatch(
      /^max-age=\d+; includeSubDomains$/,
    );
  });

  it('lets nothing load and nothing frame a JSON response', async () => {
    const response = await request(app).get('/api/v1/products');

    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
  });

  it('leaves Swagger UI free to run its scripts', async () => {
    const response = await request(app).get('/api/docs');

    expect(response.headers['content-security-policy']).toBeUndefined();
    expect(response.headers['x-frame-options']).toBe('DENY');
  });
});
