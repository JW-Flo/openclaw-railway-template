/**
 * csrf.js — Double-submit cookie CSRF protection
 *
 * Uses the double-submit cookie pattern: server generates a random token,
 * sets it as a cookie, and client must echo it back in X-CSRF-Token header.
 */

import crypto from "node:crypto";

const TOKEN_LENGTH = 32;
const COOKIE_NAME = "_csrf_token";
const HEADER_NAME = "x-csrf-token";

/**
 * Generate a new CSRF token.
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString("hex");
}

/**
 * Extract the CSRF cookie value from a request.
 */
function getCookieToken(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return match ? match.split("=")[1] : null;
}

/**
 * Create CSRF middleware.
 *
 * @param {object} opts
 * @param {string[]} [opts.exemptPaths] — paths to exempt from CSRF checks
 * @param {Function} [opts.exemptCheck] — custom check: (req) => bool, return true to skip
 * @returns {{ protect: Function, injectToken: Function }}
 */
export function createCsrfProtection(opts = {}) {
  const { exemptPaths = [], exemptCheck } = opts;

  /**
   * Middleware: ensure the CSRF cookie exists (set on every response).
   */
  function injectToken(req, res, next) {
    const existing = getCookieToken(req);
    if (!existing) {
      const token = generateToken();
      res.cookie(COOKIE_NAME, token, {
        httpOnly: false, // Client JS must read this
        secure: req.secure || req.headers["x-forwarded-proto"] === "https",
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      });
      req._csrfToken = token;
    } else {
      req._csrfToken = existing;
    }
    next();
  }

  /**
   * Middleware: validate CSRF token on state-changing methods.
   */
  function protect(req, res, next) {
    // Only check state-changing methods
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    // Check exemptions
    if (exemptPaths.some((p) => req.path.startsWith(p))) {
      return next();
    }
    if (exemptCheck && exemptCheck(req)) {
      return next();
    }

    const cookieToken = getCookieToken(req);
    // Normalize header value (could be string or array)
    const rawHeader = req.headers[HEADER_NAME];
    const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!cookieToken || !headerToken) {
      return res.status(403).json({
        ok: false,
        error: "CSRF token missing",
        hint: "Include X-CSRF-Token header matching the _csrf_token cookie",
      });
    }

    // Timing-safe comparison
    if (cookieToken.length !== headerToken.length) {
      return res.status(403).json({ ok: false, error: "CSRF token mismatch" });
    }

    const cookieBuf = Buffer.from(cookieToken);
    const headerBuf = Buffer.from(headerToken);
    if (!crypto.timingSafeEqual(cookieBuf, headerBuf)) {
      return res.status(403).json({ ok: false, error: "CSRF token mismatch" });
    }

    next();
  }

  return { protect, injectToken, COOKIE_NAME, HEADER_NAME };
}
