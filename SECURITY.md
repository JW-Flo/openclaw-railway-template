# Security

> **Scope**: `JW-Flo/openclaw-railway-template`
> **Last updated**: 2026-03-01

> **Sprint 1 note**: Several modules described in this document (`src/middleware/session-auth.js`, `src/middleware/csrf.js`, `src/lib/safe-exec.js`, `src/lib/credential-store.js`, `src/lib/bootstrap-guard.js`, `src/alerts/**`) are being added by the concurrent QA remediation sprint (Opus-01 through Opus-03). Until those PRs are merged, the current setup wizard still uses HTTP Basic auth via `requireSetupAuth` in `src/server.js`. Items marked **[Sprint 1]** are planned/in-progress, not yet live in production.

---

## Security Architecture

The post-hardening security model layers multiple defenses across the request path.

### Authentication

| Layer | Mechanism | Status | Protects |
|---|---|---|---|
| `/setup` wizard | Session-based auth replaces HTTP Basic | **[Sprint 1]** | Setup wizard, all `/setup/api/*` endpoints |
| `/setup` wizard (current) | HTTP Basic auth via `requireSetupAuth` | Live | Setup wizard, all `/setup/api/*` endpoints |
| Dashboard API | Session cookie **or** bearer token **or** Basic auth (compat fallback) | **[Sprint 1]** | All dashboard data endpoints |
| Gateway proxy | Auto-injected Bearer token | Live | All traffic forwarded to internal gateway |
| Control UI bootstrap | Token written to `localStorage` via `/openclaw` bootstrap page | Live | WebSocket + HTTP gateway connections |

**Session auth** (`src/middleware/session-auth.js`) **[Sprint 1]**: A `POST /setup/api/login` endpoint validates the password via `crypto.timingSafeEqual()` (constant-time comparison, preventing timing attacks) and issues an HTTP-only, SameSite=Strict session cookie. Session TTL defaults to 24 hours; "Remember me" extends to 30 days.

**CSRF protection** (`src/middleware/csrf.js`) **[Sprint 1]**: Double-submit cookie pattern. A `jclaw_csrf` cookie is set on every GET response; all `POST`/`PUT`/`DELETE` requests to `/setup/api/*` must echo it as a request header. Requests missing the header are rejected with `403 csrf_invalid`.

### Rate Limiting Tiers

| Endpoint group | Limit | Window |
|---|---|---|
| `/setup/api/shell` (shell execution) | 10 req / IP | 1 min |
| `/setup/api/openclaw-cmd` (agent/chat) | 30 req / IP | 1 min |
| All other `/setup/api/*` | 20 req / IP | 1 min |
| `/setup/api/login` (login attempts) | 5 req / IP | 15 min |

Rate-limit responses include `Retry-After` header. Exceeding the login limit triggers a `[AUTH ALERT]` via the alert system (see [Alert Monitoring](#alert-monitoring) below).

### Credential Storage

Credentials (API keys, bot tokens) are stored encrypted on the Railway volume:

- **Algorithm**: AES-256-GCM (authenticated encryption — detects tampering)
- **Key derivation**: HKDF from `OPENCLAW_GATEWAY_TOKEN` (or a randomly generated 64-char hex master key if unset)
- **Storage**: `${STATE_DIR}/credentials.enc.json`
- **Module**: `src/lib/credential-store.js`

Raw secrets are never written to `openclaw.json` in plaintext. The credential store is the only module that may read/write encrypted credentials.

### Bootstrap Integrity

The `/data/workspace/bootstrap.sh` script (if present) runs automatically on container startup. To prevent persistent code execution via a compromised volume:

- A SHA-256 manifest (`${STATE_DIR}/bootstrap-manifest.json`) records the hash of bootstrap scripts on first deploy.
- On each subsequent start, `src/lib/bootstrap-guard.js` compares current hashes against the manifest.
- If any script hash differs, startup is halted and an alert is sent.
- Operators can rebaseline via `POST /setup/api/bootstrap-status` → `rebaseline` action.
- Check current status: `GET /setup/api/bootstrap-status`

### Safe Process Execution

All child process spawns go through `src/lib/safe-exec.js`:

- Uses `child_process.spawn()` with **array arguments only** — never `child_process.exec()` or shell string interpolation. This prevents command injection via user-supplied values (API keys, bot tokens, provider names).
- Enforces an **allowlist** of permitted executables: `openclaw`, `git`, `gh`, `df`, `ps`, `journalctl`, `node`, `npm`, `pnpm`, `wrangler`, `railway`.
- Any spawn attempt outside the allowlist is rejected with an error logged to stdout.

Never import `child_process` directly in new code — always use `safeSpawn()` from `src/lib/safe-exec.js`.

### Gateway Token

- Auto-generated as a cryptographically random 64-character hex string (`crypto.randomBytes(32).toString("hex")`) if `OPENCLAW_GATEWAY_TOKEN` is not set.
- Persisted to `${STATE_DIR}/gateway.token` on the Railway volume so it survives redeploys.
- Injected into all proxied requests via `http-proxy` event handlers (`proxyReq` / `proxyReqWs`).
- Minimum effective length enforced at startup; single-character tokens are rejected.

---

## Alert Monitoring

The wrapper includes a built-in security alert system that sends notifications to your configured bot channel. See **[SECURITY_ALERTS_PLAN.md](./SECURITY_ALERTS_PLAN.md)** for the full architecture and configuration reference.

**Summary of the 5 monitors**:

| # | Monitor | Trigger | Severity |
|---|---|---|---|
| 1 | **SSH brute force** | ≥3 failed SSH attempts from same IP within 60 s | High |
| 2 | **Disk space** | `/data` or `/` > 85% (warning) / > 90% (critical) | Medium / High |
| 3 | **Config audit** | Daily SHA-256 comparison of `openclaw.json`, `gateway.token`, `package.json`, Dockerfile, system files | Medium |
| 4 | **Gateway crash** | Gateway process exits with non-zero code or signal | High |
| 5 | **Auth brute force** | ≥5 failed `/setup` login attempts from same IP within 60 s | High |

**Setup**: Set `ALERTS_CHAT_ID` (Telegram) or `ALERTS_CHANNEL_ID` (Discord/Slack) in Railway Variables. Alerts fall back to stdout with `[SECURITY-ALERT]` prefix if no channel is configured.

**Verify**: `GET /setup/api/security-posture` returns the current alert configuration and monitor health.

---

## Vulnerability Reporting

If you discover a security vulnerability in this template:

1. **Do not open a public GitHub issue.**
2. Email: `security@jclaw.dev` _(placeholder — replace with real contact)_
3. Include: affected component, reproduction steps, potential impact.
4. **Response SLA**: Acknowledgement within 72 hours; fix or mitigation plan within 14 days for Critical/High.
5. **Responsible disclosure**: We ask for a 90-day embargo before public disclosure, allowing time for a fix and coordinated release.

---

## Operator Security Checklist

Complete this checklist on every fresh deployment:

- [ ] **`SETUP_PASSWORD` is ≥ 16 characters** and randomly generated (not `test`, `password`, or derived from a username). The local testing default of `test` must never be used in production.
- [ ] **Railway Volume is mounted at `/data`** — verify via `GET /setup/api/railway/volume`.
- [ ] **Review workspace templates** in `/data/workspace/` on first deploy — confirm no unexpected files were added before you ran setup.
- [ ] **Set `ALERTS_CHAT_ID`** (or `ALERTS_CHANNEL_ID`) so security alerts are delivered to your bot channel. Verify with `GET /setup/api/security-posture`.
- [ ] **Check bootstrap integrity** — `GET /setup/api/bootstrap-status` should return `{ "status": "verified" }`. If it returns `tampered`, stop and investigate before proceeding.
- [ ] **Verify security posture** — `GET /setup/api/security-posture` should show all monitors active and no critical findings.
- [ ] **Upgrade to Railway Pro plan** (minimum 1 GB RAM) — the Hobby plan (512 MB) is below the ~550 MB minimum required by the OpenClaw gateway and will cause OOM crashes under load.
- [ ] **Rotate `OPENCLAW_GATEWAY_TOKEN`** after any suspected compromise — delete `${STATE_DIR}/gateway.token` and restart.

---

## Known Limitations

These are architectural constraints that are accepted risks for the current design:

| Limitation | Detail |
|---|---|
| **Single-container SPOF** | Wrapper and gateway run in one Railway container with no HA or horizontal scaling. A process crash triggers Railway's auto-restart (typically 10–30 s downtime). |
| **No MFA** | The setup wizard uses password-only auth. There is no TOTP, WebAuthn, or hardware key support. |
| **No IP allowlisting** | Any client that can reach the Railway public URL can attempt authentication. Rate limiting is the only brute-force defense. |
| **Shell API is defense-in-depth, not sandboxing** | `POST /setup/api/shell` runs commands inside the container. The allowlist prevents obvious abuse, but a sufficiently creative allowlisted command sequence could still cause harm. Restrict access to trusted operators only. |
| **Localhost proxy bypasses gateway auth** | The wrapper proxies all non-`/setup` traffic to `127.0.0.1:18789`. From the gateway's perspective, every request originates from localhost, bypassing OpenClaw's own non-local connection safeguards. The wrapper's bearer-token injection is the only auth gate for these connections. |
| **Credentials encrypted at rest but decrypted in memory** | AES-256-GCM protects credentials on the volume, but they are decrypted into process memory at runtime. A memory dump or debug endpoint leak could expose them. |
| **No audit log persistence** | Security events are logged to stdout (Railway log drain) but not persisted to the volume. Logs older than Railway's retention window are lost. |
