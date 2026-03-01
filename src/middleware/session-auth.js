import { timingSafeEqual } from 'node:crypto';

/**
 * Compare two strings in constant time.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Create a session for a request (writes to req.session).
 * @param {import('express').Request} req
 * @param {{ maxAge?: number }} [opts]
 */
export function createSession(req, opts = {}) {
  const maxAge = opts.maxAge || 8 * 60 * 60 * 1000; // 8 hours
  req.session = req.session || {};
  req.session.authenticated = true;
  req.session.createdAt = Date.now();
  req.session.maxAge = maxAge;
}

/**
 * Check if a session is valid and not expired.
 * @param {object} session
 * @returns {boolean}
 */
export function isSessionValid(session) {
  if (!session || !session.authenticated) return false;
  if (!session.createdAt || !session.maxAge) return false;
  const elapsed = Date.now() - session.createdAt;
  return elapsed < session.maxAge;
}

/**
 * Destroy a session.
 * @param {import('express').Request} req
 * @returns {Promise<void>}
 */
export function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (req.session?.destroy) {
      req.session.destroy((err) => (err ? reject(err) : resolve()));
    } else {
      if (req.session) {
        req.session.authenticated = false;
        req.session.createdAt = null;
      }
      resolve();
    }
  });
}

/**
 * Middleware: require session auth OR Basic auth fallback.
 * @param {string} setupPassword
 * @returns {import('express').RequestHandler}
 */
export function requireSessionOrBasic(setupPassword) {
  return (req, res, next) => {
    // Check session first
    if (isSessionValid(req.session)) {
      return next();
    }

    // Fall back to Basic auth (for curl/programmatic access)
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const separatorIndex = decoded.indexOf(':');
      if (separatorIndex !== -1) {
        const password = decoded.slice(separatorIndex + 1);
        if (password && safeCompare(password, setupPassword)) {
          return next();
        }
      }
    }

    // Not authenticated
    res.status(401).json({ error: 'auth_missing', message: 'Authentication required' });
  };
}
