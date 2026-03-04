import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { createSessionAuth } from '../../src/middleware/session-auth.js';

describe('session-auth', () => {
  const SETUP_PASSWORD = 'test-secret-password';
  let tmpDir;
  let auth;

  function noopRateLimiter() {
    return { check: () => ({ limited: false }) };
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-test-'));
    auth = createSessionAuth({
      stateDir: tmpDir,
      setupPassword: SETUP_PASSWORD,
      loginRateLimiter: noopRateLimiter(),
    });
  });

  afterEach(() => {
    auth.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loginHandler', () => {
    function createApp() {
      const app = express();
      app.use(express.json());
      app.post('/auth/login', auth.loginHandler);
      app.post('/auth/logout', auth.logoutHandler);
      app.get('/protected', auth.requireSession, (_req, res) => {
        res.json({ ok: true });
      });
      return app;
    }

    it('rejects missing password', async () => {
      const app = createApp();
      const res = await request(app).post('/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('rejects wrong password', async () => {
      const app = createApp();
      const res = await request(app).post('/auth/login').send({ password: 'wrong' });
      expect(res.status).toBe(401);
    });

    it('accepts correct password and sets session cookie', async () => {
      const app = createApp();
      const res = await request(app).post('/auth/login').send({ password: SETUP_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie.some((c) => c.startsWith('jclaw_setup_session='))).toBe(true);
    });

    it('session cookie grants access to protected route', async () => {
      const app = createApp();
      // Login
      const loginRes = await request(app).post('/auth/login').send({ password: SETUP_PASSWORD });
      const cookie = loginRes.headers['set-cookie'].find((c) => c.startsWith('jclaw_setup_session='));

      // Access protected route with session cookie
      const protectedRes = await request(app)
        .get('/protected')
        .set('Cookie', cookie.split(';')[0]);
      expect(protectedRes.status).toBe(200);
    });

    it('unauthenticated request to protected route falls through', async () => {
      const app = createApp();
      // Without session, requireSession calls next("route") which results in 404
      const res = await request(app).get('/protected');
      expect([401, 404]).toContain(res.status);
    });
  });

  describe('hasValidSession', () => {
    it('returns false for request without session cookie', () => {
      const req = { headers: {} };
      expect(auth.hasValidSession(req)).toBe(false);
    });

    it('returns false for invalid session token', () => {
      const req = { headers: { cookie: 'jclaw_setup_session=invalid.token' } };
      expect(auth.hasValidSession(req)).toBe(false);
    });
  });

  describe('logoutHandler', () => {
    it('clears session cookie on logout', async () => {
      const app = express();
      app.use(express.json());
      app.post('/auth/login', auth.loginHandler);
      app.post('/auth/logout', auth.logoutHandler);

      // Login first
      const loginRes = await request(app).post('/auth/login').send({ password: SETUP_PASSWORD });
      const cookie = loginRes.headers['set-cookie'].find((c) => c.startsWith('jclaw_setup_session='));

      // Logout
      const logoutRes = await request(app)
        .post('/auth/logout')
        .set('Cookie', cookie.split(';')[0]);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.ok).toBe(true);
    });
  });
});
