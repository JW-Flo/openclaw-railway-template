import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  safeCompare,
  createSession,
  isSessionValid,
  destroySession,
  requireSessionOrBasic,
} from '../../src/middleware/session-auth.js';

describe('session-auth', () => {
  describe('safeCompare', () => {
    it('returns true for matching strings', () => {
      expect(safeCompare('password123', 'password123')).toBe(true);
    });

    it('returns false for mismatching strings', () => {
      expect(safeCompare('password123', 'wrongpassword')).toBe(false);
    });

    it('returns false for different length strings', () => {
      expect(safeCompare('short', 'muchlongerstring')).toBe(false);
    });

    it('returns false for non-string inputs', () => {
      expect(safeCompare(null, 'test')).toBe(false);
      expect(safeCompare('test', undefined)).toBe(false);
      expect(safeCompare(123, 'test')).toBe(false);
    });
  });

  describe('createSession / isSessionValid', () => {
    it('creates a valid session', () => {
      const req = { session: {} };
      createSession(req);
      expect(req.session.authenticated).toBe(true);
      expect(isSessionValid(req.session)).toBe(true);
    });

    it('respects custom maxAge', () => {
      const req = { session: {} };
      createSession(req, { maxAge: 1000 }); // 1 second
      expect(isSessionValid(req.session)).toBe(true);
    });

    it('detects expired session', () => {
      const session = {
        authenticated: true,
        createdAt: Date.now() - 9 * 60 * 60 * 1000, // 9 hours ago
        maxAge: 8 * 60 * 60 * 1000, // 8 hour max
      };
      expect(isSessionValid(session)).toBe(false);
    });

    it('returns false for null/undefined session', () => {
      expect(isSessionValid(null)).toBe(false);
      expect(isSessionValid(undefined)).toBe(false);
    });

    it('returns false for unauthenticated session', () => {
      expect(isSessionValid({ authenticated: false, createdAt: Date.now(), maxAge: 99999 })).toBe(false);
    });
  });

  describe('destroySession', () => {
    it('destroys a session with destroy method', async () => {
      const req = {
        session: {
          authenticated: true,
          destroy: (cb) => cb(null),
        },
      };
      await destroySession(req);
    });

    it('clears session fields when no destroy method', async () => {
      const req = { session: { authenticated: true, createdAt: Date.now() } };
      await destroySession(req);
      expect(req.session.authenticated).toBe(false);
      expect(req.session.createdAt).toBeNull();
    });

    it('handles null session gracefully', async () => {
      const req = {};
      await destroySession(req); // should not throw
    });
  });

  describe('requireSessionOrBasic middleware', () => {
    const SETUP_PASSWORD = 'test-secret-password';

    function createApp() {
      const app = express();
      // Minimal session mock
      app.use((req, _res, next) => {
        req.session = req._testSession || {};
        next();
      });
      app.get('/protected', requireSessionOrBasic(SETUP_PASSWORD), (_req, res) => {
        res.json({ ok: true });
      });
      return app;
    }

    it('rejects unauthenticated requests with 401', async () => {
      const app = createApp();
      const res = await request(app).get('/protected');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('auth_missing');
    });

    it('accepts valid Basic auth', async () => {
      const app = createApp();
      const encoded = Buffer.from(`:${SETUP_PASSWORD}`).toString('base64');
      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Basic ${encoded}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('rejects wrong Basic auth password', async () => {
      const app = createApp();
      const encoded = Buffer.from(':wrongpassword').toString('base64');
      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Basic ${encoded}`);
      expect(res.status).toBe(401);
    });

    it('accepts valid session', async () => {
      const app = express();
      app.use((req, _res, next) => {
        req.session = {
          authenticated: true,
          createdAt: Date.now(),
          maxAge: 8 * 60 * 60 * 1000,
        };
        next();
      });
      app.get('/protected', requireSessionOrBasic(SETUP_PASSWORD), (_req, res) => {
        res.json({ ok: true });
      });
      const res = await request(app).get('/protected');
      expect(res.status).toBe(200);
    });

    it('rejects expired session without Basic auth', async () => {
      const app = express();
      app.use((req, _res, next) => {
        req.session = {
          authenticated: true,
          createdAt: Date.now() - 9 * 60 * 60 * 1000,
          maxAge: 8 * 60 * 60 * 1000,
        };
        next();
      });
      app.get('/protected', requireSessionOrBasic(SETUP_PASSWORD), (_req, res) => {
        res.json({ ok: true });
      });
      const res = await request(app).get('/protected');
      expect(res.status).toBe(401);
    });
  });
});
