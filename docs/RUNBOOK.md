# Operations Runbook

> **Scope**: `JW-Flo/openclaw-railway-template` — Railway-hosted OpenClaw wrapper.
> **Deep reference**: [CLAUDE.md](../CLAUDE.md) — "Known Failure Patterns & Runbook" section has authoritative detail. This doc surfaces the 5 most common issues as operator-friendly quick-fix steps, then adds QA-audit-specific findings.

---

## Quick Auth Pattern

```bash
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="https://openclaw-production-4e3d.up.railway.app"
curl -s -H "Authorization: Basic $AUTH" $BASE/ENDPOINT
```

---

## Common Issues

### 1. Dashboard shows "Disconnected"

**Most likely cause**: Control UI opened directly (bookmarked URL) without going through `/setup` first — the session cookie / gateway token was never injected.

**Fix in 30 seconds**:
1. Navigate to `https://…/setup` (Basic auth prompt)
2. Enter any username + your `SETUP_PASSWORD`
3. Click **Open UI** on the setup page
4. The UI now shows "Connected"

**Verify it's really a gateway problem** (not just missing auth):
```bash
curl -s $BASE/setup/healthz
# If gateway:"running",ready:true → it's auth, not gateway. Use fix above.
# If ready:false → gateway is down. See issue #3.
```

See also: CLAUDE.md → "Dashboard shows Disconnected" runbook.

---

### 2. Runner task stuck in "running"

**Cause**: Gateway restarted mid-task (leaving orphaned `running` status), or two concurrent "Run task" requests both passed the status guard before either wrote `running`.

**Fix**:
```bash
# List tasks and find the stuck one
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  $BASE/setup/api/openclaw-cmd -d '{"args":["runner","list","--json"]}'

# Reset it (replace TASK_ID)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  $BASE/setup/api/openclaw-cmd -d '{"args":["runner","reset","TASK_ID"]}'
```

If `runner reset` is unavailable, manually patch the queue file:
```bash
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  $BASE/setup/api/shell \
  -d '{"command":"python3 -c \"import json; q=json.load(open(\\\"/data/.openclaw/runner-queue.json\\\")); [t.update({\\\"status\\\":\\\"queued\\\"}) for t in q if t[\\\"id\\\"]==\\\"TASK_ID\\\" and t[\\\"status\\\"]==\\\"running\\\"]; json.dump(q,open(\\\"/data/.openclaw/runner-queue.json\\\",\\\"w\\\"),indent=2); print(\\\"done\\\")\""}'
```

See also: CLAUDE.md → "Runner task stuck in running" runbook.

---

### 3. Gateway unreachable after deploy

**Step-by-step**:
```bash
# 1. Check deployment status (is the build even done?)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/deployments?limit=3"

# 2. Soft restart (preserves config)
curl -s -X POST -H "Authorization: Basic $AUTH" $BASE/setup/api/restart-gateway

# 3. Doctor repair (fixes common config corruption)
curl -s -X POST -H "Authorization: Basic $AUTH" $BASE/setup/api/doctor

# 4. Check runtime logs for root cause
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/logs?type=runtime&limit=100"
```

**Key log lines to look for**:
- `[gateway] starting with command:` → launch attempted
- `[gateway] ready at <endpoint>` → healthy
- `[gateway] failed to become ready after 20000ms` → health-check timeout

**OOM on Hobby plan** (QA audit finding #8): The gateway needs ~550 MB RAM; Railway Hobby provides 512 MB. Symptoms: `Reached heap limit Allocation failed - JavaScript heap out of memory` in logs. **Fix**: Upgrade to Railway Pro plan (minimum 1 GB).

**Stale PID lock** (QA audit finding #9): If the gateway detects a `running` instance via an old PID lock file from a previous container:
```bash
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  $BASE/setup/api/shell -d '{"command":"rm -f /data/.openclaw/*.pid /data/.openclaw/*.lock 2>&1 && echo cleared"}'
# Then restart gateway
curl -s -X POST -H "Authorization: Basic $AUTH" $BASE/setup/api/restart-gateway
```

See also: CLAUDE.md → "Gateway unreachable after deploy" runbook.

---

### 4. Bootstrap tampered / integrity alert

> **[Sprint 1 — not yet implemented]**: The `GET /setup/api/bootstrap-status` endpoint and `src/lib/bootstrap-guard.js` module are added by the QA remediation sprint (Opus-01). Until that PR is merged, use the manual steps below.

**Until `/setup/api/bootstrap-status` is available**, inspect bootstrap scripts manually:

1. **Read the current bootstrap script**:
   ```bash
   curl -s -H "Authorization: Basic $AUTH" \
     "$BASE/setup/api/workspace/read?path=bootstrap.sh"
   ```
2. **Compare against your known-good version** (check git history for last intentional edit).
3. If the script was unexpectedly modified: **treat as a security incident** — rotate all credentials, redeploy from a clean image, and notify your team.

**After Sprint 1 lands** — `GET /setup/api/bootstrap-status` returns `{ "status": "verified" | "tampered", "changedFiles": [...] }`:

1. **Stop traffic** — do not let the gateway run until resolved.
2. **Audit the changed file**:
   ```bash
   curl -s -H "Authorization: Basic $AUTH" $BASE/setup/api/bootstrap-status
   ```
3. If the change is expected: **rebaseline**:
   ```bash
   curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
     $BASE/setup/api/bootstrap-status -d '{"action":"rebaseline"}'
   ```
4. If unexpected: **treat as a security incident**.

---

### 5. Updating OpenClaw version

The gateway binary is installed from `npm install -g openclaw@latest` during Docker build. To update:

1. **Pin the target version** in `Dockerfile`:
   ```dockerfile
   RUN npm install -g openclaw@2026.x.y
   ```
2. **Test locally** with Docker:
   ```bash
   docker build -t openclaw-railway-template .
   docker run --rm -p 8080:8080 -e PORT=8080 -e SETUP_PASSWORD=test \
     -e OPENCLAW_STATE_DIR=/data/.openclaw -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
     -v $(pwd)/.tmpdata:/data openclaw-railway-template
   curl http://localhost:8080/healthz
   ```
3. **Deploy**: commit + push → PR → merge to main → Railway auto-deploys.
4. **Verify**: `GET /healthz` and `GET /setup/healthz` should both return healthy within 2 min of deploy.

> **Important**: OpenClaw is installed at build time. A version change requires a full Docker rebuild (~5 min on Railway). Do not assume `npm update` inside the container will work — the container is immutable after build.

---

## Monitoring

### What to watch

| Signal | Where to look |
|---|---|
| Gateway health | `GET /setup/healthz` → `ready: true` |
| Memory usage | `GET /setup/api/railway/metrics?hours=1` → `memory.latest` |
| Disk usage | Alert fires at 85%/90% on `/data`. Also: `POST /setup/api/shell -d '{"command":"df -h /data"}'` |
| Security alerts | Your Telegram/Discord/Slack channel. Stdout prefix `[SECURITY-ALERT]` in Railway logs. |
| Deployment status | `GET /setup/api/railway/deployments?limit=5` |

### Railway logs

```bash
# Runtime logs (last 200 lines)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/logs?type=runtime&limit=200"

# Build logs
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/logs?type=build"
```

### Security posture

```bash
curl -s -H "Authorization: Basic $AUTH" $BASE/setup/api/security-posture
# Returns: { monitors: {...}, alerts_configured: true/false, rate_limiting: true, csrf: true, ... }
```

---

## Backup and Restore

> **Note**: Automated backup is planned for Sprint 2 (backup-manager module). Until then, use the manual procedures below.

### Manual backup

The Railway volume at `/data` contains all persistent state:

- `/data/.openclaw/openclaw.json` — gateway config
- `/data/.openclaw/gateway.token` — auth token
- `/data/.openclaw/credentials.enc.json` — encrypted credentials
- `/data/workspace/` — workspace files, memory, skills

To create a snapshot:
```bash
# List current volume contents
curl -s -H "Authorization: Basic $AUTH" $BASE/setup/api/railway/volume

# Create Railway volume backup
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  $BASE/setup/api/railway/volume/backup \
  -d '{"volumeInstanceId":"VOL_INSTANCE_ID"}'
# Get volumeInstanceId from: GET /setup/api/railway/volume
```

### Restore from backup

```bash
# List available backups
curl -s -H "Authorization: Basic $AUTH" \
  "$BASE/setup/api/railway/volume/backups?volumeInstanceId=VOL_INSTANCE_ID"

# Restore (DESTRUCTIVE — overwrites current volume)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  $BASE/setup/api/railway/volume/restore \
  -d '{"backupId":"BACKUP_ID","volumeInstanceId":"VOL_INSTANCE_ID"}'
```

---

## Emergency Procedures

### Force restart the Railway service

```bash
# Get latest deployment ID first
DEPLOY_ID=$(curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/deployments?limit=1" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['deployments'][0]['id'])")

# Redeploy
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  $BASE/setup/api/railway/deploy-action \
  -d "{\"action\":\"redeploy\",\"deploymentId\":\"$DEPLOY_ID\"}"
```

### Rotate the gateway token

If the gateway token is suspected compromised:

```bash
# 1. Delete the persisted token (wrapper will regenerate on next start)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  $BASE/setup/api/shell \
  -d '{"command":"rm -f /data/.openclaw/gateway.token && echo done"}'

# 2. Restart gateway (wrapper regenerates token and writes to openclaw.json)
curl -s -X POST -H "Authorization: Basic $AUTH" $BASE/setup/api/restart-gateway

# 3. Verify new token is in place
curl -s -H "Authorization: Basic $AUTH" $BASE/setup/healthz
```

Alternatively, set a specific token via Railway Variables (`OPENCLAW_GATEWAY_TOKEN`) and redeploy.

### Full wipe and rebuild

Only use when config is irrecoverably corrupt:

```bash
# 1. Reset config (deletes openclaw.json — requires re-onboarding)
curl -s -X POST -H "Authorization: Basic $AUTH" $BASE/setup/api/reset

# 2. Clear workspace if needed (DESTRUCTIVE)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  $BASE/setup/api/shell \
  -d '{"command":"rm -rf /data/.openclaw /data/workspace && echo wiped"}'

# 3. Redeploy to re-bootstrap workspace templates
# (triggers Railway deploy → entrypoint.sh copies workspace-templates/)
```

---

*Last updated: 2026-03-01 | Source: QA Audit + CLAUDE.md operational history*
