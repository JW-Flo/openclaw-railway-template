---
name: backup-ops
description: Backup and restore operations — trigger manual backups, list archives, restore from backup, check S3/R2 upload status via the wrapper API.
metadata: {"clawdbot":{"emoji":"💾","requires":{"bins":["curl"],"env":["SETUP_PASSWORD"]}}}
---

# Backup Operations

Manage backup and restore operations for the JClaw/OpenClaw instance through wrapper API endpoints.

## Wrapper API Endpoints

All endpoints require Basic auth with `SETUP_PASSWORD`:

```bash
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="${OPENCLAW_BASE_URL:-https://openclaw-production-4e3d.up.railway.app}"
```

### List Backups

```bash
# List all local backup archives (newest first)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/backups"
```

Returns: array of `{ name, size, created }` for each backup archive.

### Create Backup

```bash
# Trigger a manual backup now
curl -s -X POST -H "Authorization: Basic $AUTH" "$BASE/setup/api/backups"
```

Creates a tar.gz archive of `/data/.openclaw` (state) and `/data/workspace`. Includes SHA-256 manifest for integrity verification. Automatically rotates to keep last 10 local backups. If S3/R2 credentials are configured, uploads to remote storage (keeps last 30 remote).

### Download Backup

```bash
# Download a specific backup archive
curl -s -H "Authorization: Basic $AUTH" -o backup.tar.gz \
  "$BASE/setup/api/backups/backup-2026-03-01T10-30-00-000Z.tar.gz"
```

### Restore from Backup

```bash
# Restore from a specific backup (verifies integrity first)
curl -s -X POST -H "Authorization: Basic $AUTH" \
  "$BASE/setup/api/backups/backup-2026-03-01T10-30-00-000Z.tar.gz/restore"
```

**Warning**: Restore overwrites current state and workspace files. The gateway should be restarted after a restore.

## S3/R2 Configuration

Set these environment variables on Railway to enable remote backup uploads:

| Variable | Description |
|----------|-------------|
| `BACKUP_S3_BUCKET` | S3/R2 bucket name |
| `BACKUP_S3_KEY` | Access key ID |
| `BACKUP_S3_SECRET` | Secret access key |
| `BACKUP_S3_ENDPOINT` | Custom endpoint (e.g., Cloudflare R2 URL) |
| `BACKUP_S3_REGION` | Region (default: `auto`) |

```bash
# Set S3 credentials via Railway API
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/env" \
  -d '{"variables":{"BACKUP_S3_BUCKET":"my-bucket","BACKUP_S3_KEY":"AKIAIOSFODNN7","BACKUP_S3_SECRET":"wJalrXUtnFEMI"}}'
```

## Backup Schedule

Automatic backups run every `BACKUP_INTERVAL_MINUTES` (default: 60 minutes). A backup is also created on graceful shutdown (SIGTERM).

## Diagnostic Workflow

When investigating backup issues:

1. **List backups**: `GET /setup/api/backups` — check recent backups exist
2. **Check disk**: `GET /setup/api/railway/metrics?hours=1` — verify sufficient disk space
3. **Trigger manual**: `POST /setup/api/backups` — test backup creation
4. **Verify S3**: Check if `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY`, `BACKUP_S3_SECRET` are set via env vars

## When to Use

- User asks to create or manage backups
- User wants to restore from a previous state
- User asks about backup schedule or status
- Before making risky changes (create a backup first)
- User wants to configure S3/R2 remote storage

## When NOT to Use

- Railway volume snapshots (use `railway-ops`)
- Security monitoring (use `security-ops`)
- Cost tracking (use `cost-ops`)
