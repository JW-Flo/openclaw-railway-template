---
name: railway-ops
description: Railway infrastructure management — metrics, deployments, logs, volumes, env vars, and diagnostics via the wrapper API and Railway GraphQL/CLI.
metadata: {"clawdbot":{"emoji":"🚂","requires":{"bins":["curl"],"env":["RAILWAY_ACCOUNT_TOKEN"]}}}
---

# Railway Operations

Manage Railway infrastructure through the wrapper's API endpoints and direct Railway CLI/GraphQL.

## Wrapper API Endpoints

All endpoints require Basic auth with `SETUP_PASSWORD`. Use the pattern:

```bash
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="${OPENCLAW_BASE_URL:-https://openclaw-production-4e3d.up.railway.app}"
```

### Metrics (CPU, Memory, Network, Disk)

```bash
# Last 6 hours (default)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/metrics"
# Last 24 hours
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/metrics?hours=24"
# Last 7 days (max)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/metrics?hours=168"
```

Returns: `CPU_USAGE`, `CPU_LIMIT`, `MEMORY_USAGE_GB`, `MEMORY_LIMIT_GB`, `NETWORK_RX_GB`, `NETWORK_TX_GB`, `DISK_USAGE_GB` with summary (latest value) and raw time-series data.

### Deployment Status & History

```bash
# Last 10 deployments (default)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/deployments"
# Last 25 deployments
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/deployments?limit=25"
```

Returns: deployment ID, status (`SUCCESS`, `BUILDING`, `DEPLOYING`, `FAILED`, `CRASHED`), timestamps, commit info, rollback availability.

### Deploy Actions (Redeploy, Restart, Rollback, Cancel)

```bash
# Redeploy (rebuild + restart)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/deploy-action" \
  -d '{"action":"redeploy","deploymentId":"DEPLOYMENT_ID"}'

# Restart (no rebuild)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/deploy-action" \
  -d '{"action":"restart","deploymentId":"DEPLOYMENT_ID"}'

# Rollback to previous deployment
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/deploy-action" \
  -d '{"action":"rollback","deploymentId":"DEPLOYMENT_ID"}'

# Cancel in-progress build
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/deploy-action" \
  -d '{"action":"cancel","deploymentId":"DEPLOYMENT_ID"}'
```

### Build & Runtime Logs

```bash
# Runtime logs (latest deployment, default)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/logs"
# Build logs for latest deployment
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/logs?type=build"
# Logs for specific deployment
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/logs?deploymentId=DEPLOY_ID&type=runtime&limit=500"
```

### Volume Management

```bash
# List volumes and instances
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/volume"
# Create backup
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/volume/backup" \
  -d '{"volumeInstanceId":"VOLUME_INSTANCE_ID"}'
# List backups
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/volume/backups?volumeInstanceId=VOLUME_INSTANCE_ID"
# Restore from backup
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/volume/restore" \
  -d '{"backupId":"BACKUP_ID","volumeInstanceId":"VOLUME_INSTANCE_ID"}'
```

### Environment Variables (Batch with skipDeploys)

```bash
# Set multiple vars without triggering redeploy (default)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/env" \
  -d '{"variables":{"VAR1":"value1","VAR2":"value2"}}'
# Set vars AND trigger redeploy
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/env" \
  -d '{"variables":{"VAR1":"value1"},"skipDeploys":false}'
```

### Service Info

```bash
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/service"
```

Returns: project name, services, replicas, health check config, domains, environments.

## Railway CLI (Available on Instance)

The Railway CLI is installed at `/usr/local/lib/node_modules/@railway/cli`. These can be run via the shell API:

```bash
# Check Railway CLI auth
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/shell" -d '{"command":"railway whoami 2>&1"}'
# List services
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/shell" -d '{"command":"railway status --json 2>&1"}'
```

## Diagnostic Workflow

When troubleshooting Railway issues:

1. **Check health**: `GET /healthz` and `GET /setup/healthz`
2. **Check metrics**: `GET /setup/api/railway/metrics?hours=1` — look for CPU/memory spikes
3. **Check deployments**: `GET /setup/api/railway/deployments?limit=5` — look for FAILED/CRASHED
4. **Check logs**: `GET /setup/api/railway/logs?type=runtime&limit=500` — look for errors
5. **Check build logs**: `GET /setup/api/railway/logs?type=build` — if deploy failed during build

## When to Use

- User asks about Railway infrastructure metrics or health
- User wants to check deployment status or history
- User wants to rollback, restart, or redeploy
- User asks about volume/disk usage or wants to create/restore backups
- User wants to set environment variables on Railway
- User asks to troubleshoot a deployment failure
