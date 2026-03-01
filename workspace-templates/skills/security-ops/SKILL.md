---
name: security-ops
description: Security posture monitoring — check bootstrap integrity, review alert history, run security posture checks, and investigate security events via the wrapper API.
metadata: {"clawdbot":{"emoji":"🔒","requires":{"bins":["curl"],"env":["SETUP_PASSWORD"]}}}
---

# Security Operations

Monitor and manage the security posture of the JClaw/OpenClaw instance through wrapper API endpoints.

## Wrapper API Endpoints

All endpoints require Basic auth with `SETUP_PASSWORD`:

```bash
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="${OPENCLAW_BASE_URL:-https://openclaw-production-4e3d.up.railway.app}"
```

### Security Posture Dashboard

```bash
# Get all 7 security indicators (green/amber/red)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/security-posture"
```

Returns indicators for: password strength, gateway token strength, HTTPS status, rate limiting, bootstrap integrity, credential encryption, and alert monitors.

### Bootstrap Integrity

```bash
# Check bootstrap file integrity against known-good manifest
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/bootstrap-status"
```

Returns `verified: true/false` and any mismatched files. A `verified: false` result means workspace files have been tampered with since last baseline.

### Alert Configuration & History

```bash
# Get current alert config (Telegram, rules, cooldown)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/alerts/config"

# Update alert config
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/alerts/config" \
  -d '{"telegram":{"enabled":true,"botToken":"BOT_TOKEN","chatId":"CHAT_ID"}}'

# Send test alert
curl -s -X POST -H "Authorization: Basic $AUTH" "$BASE/setup/api/alerts/test"
```

### Activity Log (Security Events)

```bash
# Recent activity (all types)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/activity?limit=50"

# Filter by security-relevant types
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/activity?type=auth_failure&limit=20"
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/activity?type=gateway_down&limit=20"
```

## Diagnostic Workflow

When investigating a security concern:

1. **Check posture**: `GET /setup/api/security-posture` — identify any red indicators
2. **Check bootstrap**: `GET /setup/api/bootstrap-status` — verify file integrity
3. **Review activity**: `GET /setup/api/activity?limit=100` — look for unusual patterns
4. **Check alerts**: `GET /setup/api/alerts/config` — verify monitoring is active
5. **Test alerting**: `POST /setup/api/alerts/test` — confirm delivery works

## When to Use

- User asks about security status or posture
- User wants to verify system integrity
- User reports suspicious activity
- User wants to configure or test alerts
- After a deploy, to verify bootstrap integrity is intact
- Periodic security reviews

## When NOT to Use

- Infrastructure management (use `railway-ops`)
- Cost/budget concerns (use `cost-ops`)
- Backup/restore (use `backup-ops`)
