import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import { createCsrfProtection } from '../../src/middleware/csrf.js';

function createApp(options = {}) {
  const app = express();
  const csrf = createCsrfProtection(options);

  app.use(csrf.injectToken);
  app.use(csrf.protect);

  app.get('/test', (_req, res) => res.json({ ok: true }));
  app.post('/test', (_req, res) => res.json({ ok: true }));
  app.put('/test', (_req, res) => res.json({ ok: true }));
  app.delete('/test', (_req, res) => res.json({ ok: true }));
  app.post('/exempt', (_req, res) => res.json({ ok: true }));
  app.post('/api/v1/agent', (_req, res) => res.json({ ok: true }));

  return app;
}

describe('CSRF middleware', () => {
  let app;

  beforeEach(() => {
    app = createApp({
      exemptPaths: ['/exempt', '/api/v1/'],
    });
  });

  it('GET requests pass without CSRF token', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET sets a CSRF cookie when none exists', async () => {
    const res = await request(app).get('/test');
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const csrfCookie = setCookie.find((c) => c.startsWith('_csrf_token='));
    expect(csrfCookie).toBeDefined();
  });

  it('POST without CSRF token returns 403', async () => {
    const res = await request(app).post('/test');
    expect(res.status).toBe(403);
  });

  it('POST with valid CSRF token returns 200', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const res = await request(app)
      .post('/test')
      .set('Cookie', `_csrf_token=${token}`)
      .set('x-csrf-token', token);
    expect(res.status).toBe(200);
  });

  it('POST with mismatched token returns 403', async () => {
    const res = await request(app)
      .post('/test')
      .set('Cookie', '_csrf_token=token-aaaaaaaaaaaaaaa')
      .set('x-csrf-token', 'token-bbbbbbbbbbbbbbb');
    expect(res.status).toBe(403);
  });

  it('PUT without CSRF token returns 403', async () => {
    const res = await request(app).put('/test');
    expect(res.status).toBe(403);
  });

  it('DELETE without CSRF token returns 403', async () => {
    const res = await request(app).delete('/test');
    expect(res.status).toBe(403);
  });

  it('exempt paths skip CSRF check', async () => {
    const res = await request(app).post('/exempt');
    expect(res.status).toBe(200);
  });

  it('Bearer auth requests skip CSRF via exemptCheck', async () => {
    const appWithBearer = createApp({
      exemptPaths: ['/exempt'],
      exemptCheck: (req) => {
        const auth = req.headers.authorization || '';
        return auth.startsWith('Bearer ');
      },
    });
    const res = await request(appWithBearer)
      .post('/test')
      .set('Authorization', 'Bearer some-api-token');
    expect(res.status).toBe(200);
  });

  it('API v1 exempt path skips CSRF', async () => {
    const res = await request(app).post('/api/v1/agent');
    expect(res.status).toBe(200);
  });
});
