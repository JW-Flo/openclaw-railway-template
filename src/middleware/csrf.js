import { randomBytes } from 'node:crypto';

const TOKEN_LENGTH = 32;
const COOKIE_NAME = '_csrf';
const HEADER_NAME = 'x-csrf-token';

/**
 * Generate a random CSRF token.
 * @returns {string}
 */
export function generateToken() {
  return randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * CSRF double-submit cookie middleware.
 * Sets a CSRF cookie and validates that mutating requests include a matching token header.
 *
 * @param {object} [options]
 * @param {string[]} [options.exemptPaths] — paths to skip CSRF checks
 * @param {string[]} [options.exemptMethods] — HTTP methods to skip (default: GET, HEAD, OPTIONS)
 * @returns {import('express').RequestHandler}
 */
export function csrfProtection(options = {}) {
  const exemptPaths = options.exemptPaths || [];
  const exemptMethods = new Set(options.exemptMethods || ['GET', 'HEAD', 'OPTIONS']);

  return (req, res, next) => {
    // Parse cookies from header if req.cookies is not populated
    if (!req.cookies) {
      req.cookies = {};
      const cookieHeader = req.headers.cookie || '';
      for (const pair of cookieHeader.split(';')) {
        const idx = pair.indexOf('=');
        if (idx > 0) {
          const key = pair.slice(0, idx).trim();
          const val = pair.slice(idx + 1).trim();
          req.cookies[key] = val;
        }
      }
    }

    // Skip exempt methods
    if (exemptMethods.has(req.method)) {
      // Ensure a CSRF cookie exists for subsequent mutation requests
      if (!req.cookies[COOKIE_NAME]) {
        const token = generateToken();
        res.cookie(COOKIE_NAME, token, {
          httpOnly: false, // JS needs to read it
          sameSite: 'strict',
          secure: !!process.env.RAILWAY_PUBLIC_DOMAIN,
          path: '/',
        });
      }
      return next();
    }

    // Skip exempt paths
    for (const path of exemptPaths) {
      if (req.path.startsWith(path)) {
        return next();
      }
    }

    // Skip requests with Bearer auth (API tokens, not cookie-based)
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      return next();
    }

    // Validate: cookie token must match header token
    const cookieToken = req.cookies[COOKIE_NAME];
    const rawHeaderToken = req.headers[HEADER_NAME];
    const headerToken = Array.isArray(rawHeaderToken) ? rawHeaderToken[0] : rawHeaderToken;

    if (!cookieToken || typeof headerToken !== 'string' || cookieToken !== headerToken) {
      return res.status(403).json({ error: 'csrf_invalid', message: 'CSRF token missing or invalid' });
    }

    next();
  };
}
