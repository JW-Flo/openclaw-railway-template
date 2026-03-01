/**
 * session-auth.js — Session-based auth for /setup routes
 *
 * Extends the Basic auth with browser sessions: login once, get a cookie,
 * avoid sending Base64 credentials on every request.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SESSION_COOKIE = "jclaw_setup_session";
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Derive a session signing secret from SETUP_PASSWORD + a persisted salt.
 */
function getSessionSecret(stateDir, setupPassword) {
  const saltPath = path.join(stateDir, ".session-salt");
  let salt;
  try {
    salt = fs.readFileSync(saltPath, "utf8").trim();
  } catch {
    salt = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(saltPath, salt, { mode: 0o600 });
  }
  return crypto.pbkdf2Sync(setupPassword, salt, 10_000, 32, "sha512").toString("hex");
}

/**
 * Create session auth middleware and route handlers.
 *
 * @param {object} opts
 * @param {string} opts.stateDir — path to state directory
 * @param {string} opts.setupPassword — SETUP_PASSWORD value
 * @param {object} opts.loginRateLimiter — rate limiter with .check(key) method
 * @returns {{ requireSession, loginHandler, logoutHandler }}
 */
export function createSessionAuth({ stateDir, setupPassword, loginRateLimiter }) {
  const secret = getSessionSecret(stateDir, setupPassword);

  // In-memory session store (ephemeral — sessions lost on restart, which is fine)
  const sessions = new Map();

  // Periodic cleanup of expired sessions
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now > session.expiresAt) sessions.delete(id);
    }
  }, 60_000);
  cleanupInterval.unref();

  function createSession() {
    const id = crypto.randomBytes(32).toString("hex");
    const hmac = crypto.createHmac("sha256", secret).update(id).digest("hex");
    const token = `${id}.${hmac}`;
    sessions.set(id, {
      createdAt: Date.now(),
      expiresAt: Date.now() + MAX_AGE_MS,
    });
    return token;
  }

  function validateSessionToken(token) {
    if (!token || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [id, hmac] = parts;
    const expectedHmac = crypto.createHmac("sha256", secret).update(id).digest("hex");
    if (hmac.length !== expectedHmac.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) return false;
    const session = sessions.get(id);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      sessions.delete(id);
      return false;
    }
    return true;
  }

  function getSessionCookie(req) {
    const cookies = req.headers.cookie || "";
    const match = cookies
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    return match ? match.split("=")[1] : null;
  }

  function setCookieOpts(req) {
    return {
      httpOnly: true,
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
      sameSite: "strict",
      path: "/",
      maxAge: MAX_AGE_MS,
    };
  }

  /**
   * Middleware: check setup session cookie first, fall back to Basic auth.
   * This replaces requireSetupAuth for browser routes.
   */
  function requireSession(req, res, next) {
    // Check setup session cookie
    const sessionToken = getSessionCookie(req);
    if (validateSessionToken(sessionToken)) {
      req.dashUser = { id: "session-auth", username: "owner", role: "owner", displayName: "Owner" };
      return next();
    }
    // Fall back to existing auth (Basic auth for curl, dashboard session for SvelteKit)
    // This is handled by the caller chaining with requireSetupAuth
    return next("route");
  }

  /**
   * POST /auth/login — validate password, create session.
   */
  function loginHandler(req, res) {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const rl = loginRateLimiter.check(ip);
    if (rl.limited) {
      return res.status(429).json({
        ok: false,
        error: `Too many login attempts. Retry in ${rl.retryAfter}s.`,
      });
    }

    const { password } = req.body || {};
    if (!password || typeof password !== "string") {
      return res.status(400).json({ ok: false, error: "Password required" });
    }

    // Timing-safe comparison
    const inputHash = crypto.createHash("sha256").update(password).digest();
    const expectedHash = crypto.createHash("sha256").update(setupPassword).digest();
    if (!crypto.timingSafeEqual(inputHash, expectedHash)) {
      return res.status(401).json({ ok: false, error: "Invalid password" });
    }

    const token = createSession();
    res.cookie(SESSION_COOKIE, token, setCookieOpts(req));
    return res.json({ ok: true, redirect: "/setup" });
  }

  /**
   * POST /auth/logout — destroy session.
   */
  function logoutHandler(req, res) {
    const sessionToken = getSessionCookie(req);
    if (sessionToken) {
      const parts = sessionToken.split(".");
      if (parts.length === 2) {
        sessions.delete(parts[0]);
      }
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return res.json({ ok: true });
  }

  /**
   * Validate a request's setup session cookie. Returns true if valid.
   */
  function hasValidSession(req) {
    const token = getSessionCookie(req);
    return validateSessionToken(token);
  }

  return {
    requireSession,
    hasValidSession,
    loginHandler,
    logoutHandler,
    cleanup() {
      clearInterval(cleanupInterval);
    },
  };
}
