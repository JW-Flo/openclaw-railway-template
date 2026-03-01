# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Railway deployment wrapper for **OpenClaw** (an AI coding assistant platform). It provides:

- A web-based setup wizard at `/setup` (protected by `SETUP_PASSWORD`)
- Automatic reverse proxy from public URL → internal OpenClaw gateway
- Persistent state via Railway Volume at `/data`

The wrapper manages the OpenClaw lifecycle: onboarding → gateway startup → traffic proxying.

## Development Commands

```bash
# Local development (requires OpenClaw installed globally or OPENCLAW_ENTRY set)
npm run dev

# Production start
npm start

# Syntax check
npm run lint
```

## Docker Build & Local Testing

```bash
# Build the container
docker build -t openclaw-railway-template .

# Run locally with volume
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  openclaw-railway-template

# Access setup wizard
open http://localhost:8080/setup  # password: test
```

## Architecture

### Request Flow

1. **User → Railway → Wrapper (Express on PORT)** → routes to:
   - `/setup/*` → setup wizard (auth: Basic with `SETUP_PASSWORD`)
   - All other routes → proxied to internal gateway

2. **Wrapper → Gateway** (localhost:18789 by default)
   - HTTP/WebSocket reverse proxy via `http-proxy`
   - Automatically injects `Authorization: Bearer <token>` header

### Lifecycle States

1. **Unconfigured**: No `openclaw.json` exists
   - All non-`/setup` routes redirect to `/setup`
   - User completes setup wizard → runs `openclaw onboard --non-interactive`

2. **Configured**: `openclaw.json` exists
   - Wrapper spawns `openclaw gateway run` as child process
   - Waits for gateway to respond on multiple health endpoints
   - Proxies all traffic with injected bearer token

### Key Files

- **src/server.js** (main entry): Express wrapper, proxy setup, gateway lifecycle management, configuration persistence, DevOps APIs (server logic only - no inline HTML/CSS)
- **src/public/** (static assets):
  - **setup.html**: Setup wizard HTML structure
  - **dashboard.html**: DevOps dashboard with overview, projects, models, and tools tabs
  - **loading.html**: Loading/splash page
  - **tui.html**: Terminal UI page
- **workspace-templates/**: Agent personality templates (IDENTITY, USER, MEMORY, TOOLS, AGENTS, SOUL) + custom skills (`deploy-pipeline`, `project-ops`, `market-agents`, `railway-ops`, `roadmap-planner`) auto-copied to workspace on first boot
- **Dockerfile**: Single-stage build (installs OpenClaw, gh, jq, wrangler, railway CLI)

### Environment Variables

**Required:**
- `SETUP_PASSWORD` — protects `/setup` wizard

**Recommended (Railway template defaults):**
- `OPENCLAW_STATE_DIR=/data/.openclaw` — config + credentials
- `OPENCLAW_WORKSPACE_DIR=/data/workspace` — agent workspace

**Optional:**
- `OPENCLAW_GATEWAY_TOKEN` — auth token for gateway (auto-generated if unset)
- `PORT` — wrapper HTTP port (default 8080)
- `INTERNAL_GATEWAY_PORT` — gateway internal port (default 18789)
- `OPENCLAW_ENTRY` — path to `entry.js` (default `/usr/local/lib/node_modules/openclaw/dist/entry.js`)

### Authentication Flow

The wrapper manages a **two-layer auth scheme**:

1. **Setup wizard auth**: Basic auth with `SETUP_PASSWORD` (src/server.js:190)
2. **Gateway auth**: Bearer token (auto-generated or from `OPENCLAW_GATEWAY_TOKEN` env)
   - Token is auto-injected into proxied requests (src/server.js:1122, src/server.js:1126)
   - Persisted to `${STATE_DIR}/gateway.token` if not provided via env (src/server.js:25-48)
3. **Control UI auth**: Token is injected into `localStorage["openclaw.control.settings.v1"]` via a bootstrap page (src/server.js:1158-1183)
   - The Control UI reads its auth token from localStorage, NOT from URL params
   - A bootstrap page at `/openclaw` writes the token to localStorage and then redirects to `/openclaw?_boot=1` which is proxied to the gateway

### Onboarding Process

When the user runs setup (src/server.js:522-693):

1. Calls `openclaw onboard --non-interactive` with user-selected auth provider
2. Writes channel configs (Telegram/Discord/Slack) directly to `openclaw.json` via `openclaw config set --json`
3. Force-sets gateway config to use token auth + loopback bind + allowInsecureAuth
4. Spawns gateway process
5. Waits for gateway readiness (polls multiple endpoints)

**Important**: Channel setup bypasses `openclaw channels add` and writes config directly because `channels add` is flaky across different OpenClaw builds.

### Gateway Token Injection

The wrapper **always** injects the bearer token into proxied requests so browser clients don't need to know it:

- HTTP requests: via `proxy.on("proxyReq")` event handler (src/server.js:736)
- WebSocket upgrades: via `proxy.on("proxyReqWs")` event handler (src/server.js:741)

**Important**: Token injection uses `http-proxy` event handlers (`proxyReq` and `proxyReqWs`) rather than direct `req.headers` modification. Direct header modification does not reliably work with WebSocket upgrades, causing intermittent `token_missing` or `token_mismatch` errors.

This allows the Control UI at `/openclaw` to work without user authentication.

## Common Development Tasks

### Testing the setup wizard

1. Delete `${STATE_DIR}/openclaw.json` (or run Reset in the UI)
2. Visit `/setup` and complete onboarding
3. Check logs for gateway startup and channel config writes

### Testing authentication

- Setup wizard: Clear browser auth, verify Basic auth challenge
- Gateway: Remove `Authorization` header injection (src/server.js:736) and verify requests fail

### Debugging gateway startup

Check logs for:
- `[gateway] starting with command: ...` (src/server.js:142)
- `[gateway] ready at <endpoint>` (src/server.js:100)
- `[gateway] failed to become ready after 20000ms` (src/server.js:109)

If gateway doesn't start:
- Verify `openclaw.json` exists and is valid JSON
- Check `STATE_DIR` and `WORKSPACE_DIR` are writable
- Ensure bearer token is set in config

### Modifying onboarding args

Edit `buildOnboardArgs()` (src/server.js:442-496) to add new CLI flags or auth providers.

### Adding new channel types

1. Add channel-specific fields to `/setup` HTML (src/public/setup.html)
2. Add config-writing logic in `/setup/api/run` handler (src/server.js)
3. Update client JS to collect the fields (src/public/setup-app.js)

## Timezone

The user operates in **CST (Central Standard Time, America/Chicago)**. All cron jobs, timestamps in the UI, and time-related configurations should default to `America/Chicago`. The server itself runs in UTC, but user-facing times should be in CST/CDT.

## Live Instance

- **URL**: `https://openclaw-production-4e3d.up.railway.app`
- **Dashboard**: `/dashboard` (Basic auth)
- **Control UI**: `/openclaw` (no auth needed, token auto-injected)
- **Setup Wizard**: `/setup` (Basic auth)
- **Current Provider**: OpenAI (`openai/gpt-4o-mini`)
- **Fallbacks**: `openai/gpt-4.1-nano`, `openai/gpt-4.1-mini`, `openai/gpt-4.1`, `openai/o4-mini` (reasoning), `google/gemini-2.5-flash:free`, `openrouter/auto`
- **Routing**: Free-first triage (Gemini Flash classifies prompts → routes to cheapest capable model)
- **Agent timeout**: 180 seconds
- **Cron jobs**: `daily-health-check` (9 AM CT), `hourly-heartbeat` (every 1h)
- **Agent personality**: Addresses user as "Joe" or "Overlord" (see workspace SOUL.md)

### Railway Project

- **Project**: `mindful-communication` (ID: `c57527ed-e599-42da-8f49-7fb30c6c4166`)
- **Service**: `OpenClaw` (ID: `dac5966e-646e-4644-b3e9-cd31352f696d`)
- **Environment**: `production` (ID: `7932450e-bf32-4428-905e-de0c3dff381f`)
- **Volume**: mounted at `/data`

### Managed Projects (cloned in workspace)

| Project | Repo | Workspace Path |
|---------|------|----------------|
| Atlas-IT | `JW-Flo/Project-AtlasIT` | `/data/workspace/Project-AtlasIT` |
| AWhittleWandering | `JW-Flo/AWhittleWandering` | `/data/workspace/AWhittleWandering` |
| Market Agents | `JW-Flo/market_agents` | `/data/workspace/market_agents` |
| JW-Site | `JW-Flo/JW-Site` | `/data/workspace/JW-Site` |

### DevOps Credentials (all set on Railway)

`GH_PAT`, `OPENAI_API_KEY`, `OPENROUTER_API_TOKEN`, `ANTHROPIC_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `RAILWAY_ACCOUNT_TOKEN`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `GROK_API_KEY`

### Installed CLI Tools

`gh`, `git`, `node`, `npm`, `jq`, `wrangler`, `railway`, `clawhub`

## Orchestrator Management (from Claude Code sessions)

All management is done via the wrapper's API endpoints using `curl`. The live instance does NOT have a browser — use `curl` with Basic auth.

### Auth Pattern

```bash
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
curl -s -H "Authorization: Basic $AUTH" https://openclaw-production-4e3d.up.railway.app/ENDPOINT
```

### Check Instance Health

```bash
# Quick health
curl -s https://openclaw-production-4e3d.up.railway.app/healthz
# Detailed health
curl -s https://openclaw-production-4e3d.up.railway.app/setup/healthz
# Debug info + gateway logs
curl -s -H "Authorization: Basic $AUTH" https://openclaw-production-4e3d.up.railway.app/setup/api/debug
```

### Switch AI Provider

```bash
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  https://openclaw-production-4e3d.up.railway.app/setup/api/switch-provider \
  -d '{"authChoice":"openrouter-api-key","authSecret":"YOUR_TOKEN","model":"openrouter/auto"}'
```

Valid `authChoice` values: `apiKey` (Anthropic), `openrouter-api-key`, `openai-api-key`, `gemini-api-key`, etc.

### Skills Management

```bash
# List all skills (bundled + workspace + managed)
curl -s -H "Authorization: Basic $AUTH" .../setup/api/skills/list
# List only eligible skills
curl -s -H "Authorization: Basic $AUTH" .../setup/api/skills/eligible
# Check skill requirements
curl -s -H "Authorization: Basic $AUTH" .../setup/api/skills/check
# Install from ClawHub (use force:true for VirusTotal-flagged skills after vetting)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/skills/install -d '{"source":"clawhub-slug"}'
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/skills/install -d '{"source":"clawhub-slug","force":true}'
# Uninstall a workspace skill
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/skills/uninstall -d '{"name":"skill-name"}'
# Search ClawHub
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/skills/search -d '{"query":"web search"}'
# Get info about a skill
curl -s -H "Authorization: Basic $AUTH" .../setup/api/skills/info/skill-name
```

**Note**: Skills auto-load when their requirements are met (no explicit enable/disable). Skills are snapshotted when a session starts — changes take effect on the next new session. The dashboard has a Skills tab for visual management.

### Model Management

```bash
# Get current model
curl -s -H "Authorization: Basic $AUTH" .../setup/api/models/current
# Set model
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/models/set -d '{"model":"openrouter/auto"}'
# List available models
curl -s -H "Authorization: Basic $AUTH" .../setup/api/models/list
```

**Note**: `openclaw models` (no args) shows current model. The CLI subcommand is `models` not `models get`.

### Project Management

```bash
# Status of all cloned projects
curl -s -H "Authorization: Basic $AUTH" .../setup/api/projects/status
# Sync (clone or pull) repos
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/projects/sync \
  -d '{"repos":["JW-Flo/Project-AtlasIT","JW-Flo/AWhittleWandering","JW-Flo/market_agents","JW-Flo/JW-Site"]}'
```

### Run Shell Commands on Instance

```bash
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/shell -d '{"command":"npm test","cwd":"market_agents"}'
```

Blocklist-based safety (blocks `rm -rf /`, `mkfs`, `dd`, `shutdown`, etc.). The `cwd` param is relative to workspace dir.

### Run OpenClaw CLI Commands

```bash
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/openclaw-cmd -d '{"args":["models"]}'
# Also: config get, config set, doctor, pairing, channels, models, etc.
# Blocked: onboard, gateway (use dedicated endpoints instead)
```

### Railway Infrastructure Management

All Railway operations are now available via wrapper API endpoints (no more raw GraphQL needed).

```bash
# Set env vars (batch, without triggering redeploy by default)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/railway/env -d '{"variables":{"VAR_NAME":"value","VAR2":"value2"}}'
# Set env vars AND trigger redeploy
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/railway/env -d '{"variables":{"VAR":"val"},"skipDeploys":false}'

# Metrics (CPU, memory, network, disk) - last 6 hours default, max 168
curl -s -H "Authorization: Basic $AUTH" .../setup/api/railway/metrics?hours=6

# Deployment history (last 10 default, max 50)
curl -s -H "Authorization: Basic $AUTH" .../setup/api/railway/deployments?limit=10

# Deploy actions (redeploy, restart, rollback, cancel)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/railway/deploy-action -d '{"action":"redeploy","deploymentId":"DEPLOY_ID"}'

# Build & runtime logs (auto-resolves latest deployment if none specified)
curl -s -H "Authorization: Basic $AUTH" .../setup/api/railway/logs?type=runtime&limit=200
curl -s -H "Authorization: Basic $AUTH" .../setup/api/railway/logs?type=build

# Volume info (list volumes, sizes, state)
curl -s -H "Authorization: Basic $AUTH" .../setup/api/railway/volume

# Volume backups (create, list, restore)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/railway/volume/backup -d '{"volumeInstanceId":"VOL_INSTANCE_ID"}'
curl -s -H "Authorization: Basic $AUTH" .../setup/api/railway/volume/backups?volumeInstanceId=VOL_INSTANCE_ID
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/railway/volume/restore -d '{"backupId":"BACKUP_ID","volumeInstanceId":"VOL_INSTANCE_ID"}'

# Service info (project, services, replicas, domains, health config)
curl -s -H "Authorization: Basic $AUTH" .../setup/api/railway/service
```

**Note**: Env var batch setter defaults to `skipDeploys: true`. Set `"skipDeploys": false` to auto-redeploy after setting.

### Gateway Management

```bash
# Restart gateway
curl -s -X POST -H "Authorization: Basic $AUTH" .../setup/api/restart-gateway
# Run doctor --repair
curl -s -X POST -H "Authorization: Basic $AUTH" .../setup/api/doctor
# Full reset (deletes config, requires re-onboarding)
curl -s -X POST -H "Authorization: Basic $AUTH" .../setup/api/reset
```

### Workspace File Management

```bash
# Write a file
curl -s -X POST -H "Authorization: Basic $AUTH" \
  ".../setup/api/workspace/write?path=MEMORY.md" \
  -H "Content-Type: text/plain" -d "# Updated memory content"
# Read a file
curl -s -H "Authorization: Basic $AUTH" ".../setup/api/workspace/read?path=MEMORY.md"
# List directory
curl -s -H "Authorization: Basic $AUTH" ".../setup/api/workspace/ls?path=."
```

### Telegram Bot Setup

1. Message `@BotFather` on Telegram, create a bot, get the token
2. Add via setup wizard or directly:
   ```bash
   curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
     .../setup/api/openclaw-cmd \
     -d '{"args":["config","set","--json","channels.telegram","{\"enabled\":true,\"dmPolicy\":\"pairing\",\"botToken\":\"BOT_TOKEN\",\"groupPolicy\":\"allowlist\",\"streamMode\":\"partial\"}"]}'
   ```
3. Restart gateway, then approve pairing:
   ```bash
   curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
     .../setup/api/pairing/approve -d '{"channel":"telegram","code":"THE_CODE"}'
   ```

### Cron Job Management

```bash
# List all cron jobs
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/openclaw-cmd -d '{"args":["cron","list","--json"]}'
# Run a cron job now (debug)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/openclaw-cmd -d '{"args":["cron","run","JOB_ID"]}'
# Add a new cron job
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/openclaw-cmd \
  -d '{"args":["cron","add","--name","my-job","--cron","0 9 * * *","--tz","America/Chicago","--system-event","Description of what to do","--timeout-seconds","300","--session","main","--json"]}'
# Check cron scheduler status
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/openclaw-cmd -d '{"args":["cron","status"]}'
```

### Agent Testing

```bash
# Run agent via shell API (gateway-routed)
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  .../setup/api/shell \
  -d '{"command":"openclaw agent --session-id test1 --message \"Your message here\" --timeout 180 2>&1 | tail -300"}'
```

### Deploy Workflow (code changes)

Follow this exact sequence for every PR. Do NOT skip the review step.

**Important**: The `gh` CLI may not be available in all environments. Always use the GitHub REST API via `curl` with `$GH_PAT` as shown below. If `gh` is installed and working, you may use it, but the `curl` approach is the canonical fallback and is always reliable.

1. **Develop** on a feature branch (`claude/<description>-<sessionId>`)
2. **Lint**: `npm run lint` to verify syntax
3. **Commit & push**: Commit with descriptive message, `git push -u origin <branch>`
4. **Create PR** via GitHub API (use `$GH_PAT`):
   ```bash
   curl -s -X POST "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls" \
     -H "Authorization: token ${GH_PAT}" -H "Content-Type: application/json" \
     -d '{"title":"PR title","body":"## Summary\n- ...\n\n## Test plan\n- [ ] ...","head":"branch-name","base":"main"}'
   ```
5. **Request Copilot review**:
   ```bash
   curl -s -X POST -H "Authorization: token ${GH_PAT}" -H "Content-Type: application/json" \
     "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls/NUMBER/requested_reviewers" \
     -d '{"reviewers":["Copilot"]}'
   ```
6. **Wait for review** (~30-60s), then fetch comments:
   ```bash
   curl -s -H "Authorization: token ${GH_PAT}" \
     "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls/NUMBER/reviews"
   curl -s -H "Authorization: token ${GH_PAT}" \
     "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls/NUMBER/comments"
   ```
7. **Fix findings**: Address all actionable review comments (security, bugs, docs). Acknowledged-risk items (e.g. architecture decisions) can be noted and skipped.
8. **Push fixes**, then **re-request review** via the reviewers API:
   ```bash
   curl -s -X POST -H "Authorization: token ${GH_PAT}" -H "Content-Type: application/json" \
     "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls/NUMBER/requested_reviewers" \
     -d '{"reviewers":["Copilot"]}'
   ```
   Note: Pushing new commits alone does not re-trigger Copilot. You must re-request via the API.
9. **Verify clean**: Wait ~60s, re-fetch reviews/comments, confirm no new actionable findings
10. **Squash merge**:
    ```bash
    curl -s -X PUT -H "Authorization: token ${GH_PAT}" -H "Content-Type: application/json" \
      "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls/NUMBER/merge" \
      -d '{"merge_method":"squash"}'
    ```
11. **Reset feature branch** (squash merge diverges history): `git fetch origin main && git reset --hard origin/main`
12. Railway **auto-deploys** from main (~60-90s for Docker build)

### Full Status Check (copy-paste)

```bash
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="https://openclaw-production-4e3d.up.railway.app"
echo "=== Health ===" && curl -s $BASE/healthz
echo -e "\n=== Gateway ===" && curl -s $BASE/setup/healthz | python3 -m json.tool
echo -e "\n=== Model ===" && curl -s -H "Authorization: Basic $AUTH" $BASE/setup/api/models/current
echo -e "\n=== Projects ===" && curl -s -H "Authorization: Basic $AUTH" $BASE/setup/api/projects/status | python3 -m json.tool
echo -e "\n=== Railway Metrics ===" && curl -s -H "Authorization: Basic $AUTH" $BASE/setup/api/railway/metrics?hours=1 | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'  {k}: {v[\"latest\"]}') for k,v in d.get('summary',{}).items()]" 2>/dev/null || echo "  (unavailable)"
echo -e "\n=== Railway Deploys ===" && curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/railway/deployments?limit=3" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'  {x[\"status\"]:10s} {x[\"createdAt\"]:25s} {(x.get(\"meta\") or {}).get(\"commitMessage\",\"\")}') for x in d.get('deployments',[])]" 2>/dev/null || echo "  (unavailable)"
echo -e "\n=== Credentials ===" && curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" $BASE/setup/api/shell -d '{"command":"for v in GH_PAT OPENAI_API_KEY OPENROUTER_API_TOKEN ANTHROPIC_API_KEY CLOUDFLARE_ACCOUNT_ID RAILWAY_ACCOUNT_TOKEN TELEGRAM_API_ID TELEGRAM_API_HASH GROK_API_KEY; do val=$(printenv $v); if [ -n \"$val\" ]; then echo \"$v: SET\"; else echo \"$v: MISSING\"; fi; done"}'
```

## Railway Deployment Notes

- Template must mount a volume at `/data`
- Must set `SETUP_PASSWORD` in Railway Variables
- Public networking must be enabled (assigns `*.up.railway.app` domain)
- OpenClaw is installed via `npm install -g openclaw@latest` during Docker build
- DevOps tools installed: `gh`, `jq`, `wrangler`, `railway` CLI
- Workspace templates auto-copied on first boot from `workspace-templates/`
- Git credentials auto-configured from `GH_PAT` env var via `entrypoint.sh`

## Quirks & Gotchas

1. **Gateway token must be stable across redeploys** → persisted to volume if not in env
2. **Channels are written via `config set --json`, not `channels add`** → avoids CLI version incompatibilities
3. **Gateway readiness check polls multiple endpoints** (`/openclaw`, `/`, `/health`) → some builds only expose certain routes (src/server.js:92)
4. **Discord bots require MESSAGE CONTENT INTENT** → document this in setup wizard (src/server.js:295-298)
5. **Gateway spawn inherits stdio** → logs appear in wrapper output (src/server.js:134)
6. **WebSocket auth requires proxy event handlers** → Direct `req.headers` modification doesn't work for WebSocket upgrades with http-proxy; must use `proxyReqWs` event (src/server.js:741) to reliably inject Authorization header
7. **Control UI requires allowInsecureAuth to bypass pairing** → Set `gateway.controlUi.allowInsecureAuth=true` during onboarding to prevent "disconnected (1008): pairing required" errors (GitHub issue #2284). Wrapper already handles bearer token auth, so device pairing is unnecessary.
8. **Control UI reads token from localStorage, not URL params** → The `?token=` URL parameter is NOT used by the Control UI JS for WebSocket auth. The wrapper serves a bootstrap page at `/openclaw` that writes the token to `localStorage["openclaw.control.settings.v1"]` before loading the actual UI (src/server.js:1158-1183).
9. **OpenClaw CLI `models` subcommand** → Use `openclaw models` (no args) for current model info. `models get` does NOT exist. `models list` and `models set <model>` work as expected.
10. **Claude Code cannot browse the UI** → No Puppeteer/browser. Use `curl` against API endpoints for all management. `WebFetch` can fetch static HTML but cannot execute JS (so SPAs like `/dashboard` and `/openclaw` won't render).
11. **Railway env vars trigger redeploy** → Use the batch endpoint `POST /setup/api/railway/env` with `skipDeploys: true` (default) to set multiple vars without triggering N separate redeploys. Manually redeploy when ready.
12. **Squash merges require rebase** → After squash-merging a PR, the feature branch diverges from main. Always `git fetch origin main && git rebase origin/main` before the next PR.
13. **Shell API blocklist uses word-boundary regex** → Simple `includes()` matching caused false positives (e.g., "dd" blocked "add"). Fixed to use `\b` word-boundary regex patterns.
14. **Claude Max cannot be used with OpenClaw** → Anthropic blocked third-party OAuth access (Jan 2026). Only standard API keys from `console.anthropic.com` work. Max subscriptions are for claude.ai and Claude Code only.
15. **OpenClaw cron jobs use `--system-event` for main session** → `--message` only works with `--session isolated`. Main session jobs require `--system-event`. Manage via `openclaw cron list/add/rm/run`.
16. **Both API providers need credits** → Check OpenRouter balance at `openrouter.ai/settings/credits` and Anthropic balance at `console.anthropic.com`. OpenClaw auto-disables profiles with billing errors (with backoff); reset via editing `auth-profiles.json`.
17. **`gh` CLI may not be available** → In Claude Code sessions or CI environments, `gh` may not be installed. Always prefer the GitHub REST API via `curl -H "Authorization: token ${GH_PAT}"` for PR creation, review requests, merging, and issue management. The `gh` CLI is installed on the Railway instance but not guaranteed in development environments.
18. **External API tokens** → API tokens created via `/setup/api/tokens/create` use `jclaw_` prefix and Bearer auth. Tokens are stored in `${STATE_DIR}/api-tokens.json`. External endpoints are at `/api/v1/*` (health, status, agent/message, tasks/add, tasks).
19. **Railway API endpoints** → All Railway infrastructure management (metrics, deployments, logs, volumes, backups, env vars) is now available via `/setup/api/railway/*` endpoints. No need for raw GraphQL calls. Requires `RAILWAY_ACCOUNT_TOKEN` env var.
20. **Railway Agent Skills** → The `railway-ops` workspace skill teaches the OpenClaw agent how to use the Railway API endpoints for infrastructure management. Auto-bootstrapped on first boot from `workspace-templates/skills/railway-ops/`.
21. **"Gateway disconnected" is usually auth, not gateway** → Most "gateway down" reports are actually missing session/token context. The user opened the Control UI directly without going through `/setup` first. Fix: navigate to `/setup` and open the UI from there — the setup page injects the required auth token via the bootstrap page.
22. **Dashboard 401s from auth realm mismatch** → Dashboard API endpoints may reject session-cookie-authenticated users if they only check Basic auth. Any new endpoint serving the dashboard UI must accept session cookie, bearer token, AND Basic auth as fallback.
23. **Runner task queue is JSON-backed on /data** → Non-atomic writes can corrupt the queue under concurrent access. Always write to a temp file, fsync, then rename. Treat "run task" as a compare-and-swap on status (`queued` → `running`) to prevent double-execution from concurrent requests.
24. **Gateway boot race** → Immediately after a deploy/restart, the dashboard may show 502/timeouts until the gateway health check passes. The wrapper polls for readiness — correlate wrapper logs (first successful `/healthz`) to confirm the gateway is truly ready before investigating further.

## Known Failure Patterns & Runbook

### "Dashboard shows Disconnected"

1. Check if the user accessed the UI directly (not via `/setup`) → missing token/cookie context
2. Check `GET /setup/healthz` — if gateway is running, it's an auth issue
3. Check `GET /healthz` — if wrapper is healthy but gateway unreachable, wait for boot
4. Fix: navigate to `/setup`, use "Open UI" action, which injects auth context

### "Runner task stuck in running"

1. Check if the gateway restarted mid-task (logs: `[gateway] starting with command`)
2. Check for concurrent run requests that bypassed the status guard
3. Fix: manually set task status back to `queued` or `failed` via the runner API/JSON file

### "Gateway unreachable after deploy"

1. Check deployment status: `GET /setup/api/railway/deployments?limit=3`
2. Check runtime logs: `GET /setup/api/railway/logs?type=runtime&limit=200`
3. Check if `openclaw.json` exists and is valid
4. Check if gateway port (18789) is binding correctly in logs
5. If all else fails: `POST /setup/api/restart-gateway`

### Auth failure classification

When debugging auth issues, distinguish between these error states:
- **401 `auth_missing`**: No credentials provided — user needs to authenticate
- **403 `auth_forbidden`**: Credentials present but insufficient — wrong role/scope
- **503 `gateway_unreachable`**: Auth is fine but gateway not responding — wait or restart
- **409 `runner_busy`**: Auth is fine, gateway is fine, but runner is occupied

## Tool Design Principles

Lessons from building Claude Code that apply to this project's tool/skill design:

1. **Shape tools to model capabilities** — Give the agent tools that match what it's good at. A general-purpose `shell` command is powerful but requires the model to know CLI syntax. Wrapper API endpoints (like `/setup/api/railway/metrics`) are higher-level tools that reduce the chance of errors.

2. **Progressive disclosure over context stuffing** — Don't put everything in the system prompt. Use skills (SKILL.md files) as progressive disclosure: the agent discovers capabilities by reading skill files, which reference other files. This keeps the base prompt lean and lets the agent build context as needed.

3. **Structured outputs for elicitation** — When the agent needs user input, structured tool calls (with predefined options) work better than free-text questions. The wrapper's dashboard forms and API responses follow this pattern.

4. **Revisit tools as models improve** — Tools that were necessary for earlier models may become constraining. The workspace templates should evolve: if the agent gets better at shell commands, some wrapper API endpoints may become unnecessary. If it gets better at context-building, reduce prescriptive instructions.

5. **Search capabilities compound** — The agent's ability to build its own context improves dramatically with good search tools. The wrapper's `workspace/ls`, `workspace/read`, and `shell` API give the OpenClaw agent grep/find capabilities across the workspace. Skills can reference other files, enabling nested context discovery.

6. **Keep the tool count small** — Every new tool is one more option the model has to evaluate. Before adding a new wrapper API endpoint, consider whether an existing tool (like `shell` or `openclaw-cmd`) already covers the use case.

## Cross-Project Failure Patterns

Common failure modes across the managed project fleet (from operational experience):

### Auth/Session Boundary Failures (all projects)
- UI calls API without required auth headers → 401
- Session cookie vs bearer token vs Basic auth precedence mismatches
- Fix: one canonical auth gate per project that accepts all valid credential types

### Automation Feedback Loops (Project-AtlasIT)
- Workflows that commit artifacts must NOT trigger on `push: [main]`
- Evidence-generating workflows should use `workflow_dispatch` or PR-only contexts
- Add CI linter: fail if a workflow has both `push: [main]` and `git commit` + `git push` steps

### Health Check Misrouting (AWhittleWandering)
- Cloudflare `workers_dev = false` can disable the expected probe URL
- CI health checks should compute URLs from wrangler output, not use static strings
- Split health checks by failure class: DNS/route disabled vs auth failure vs service unhealthy

### Trading System Safety (market_agents)
- Error counters must be deterministic: store `consecutiveErrors` + `lastErrorAt`, reset only on full cycle success
- All external API calls need timeouts + jittered retries
- Audit log on every side-effecting step (order placement, cancel, credential change)
- Treat any change to safety invariants (kill switch, max position, daily loss limit) as merge-blocking
