# Security Alerts Plan

> **Branch**: `claude/plan-security-alerts-yjnXn`
> **Date**: 2026-02-22
> **Status**: Draft — awaiting review

---

## Context

The openclaw-railway-template currently has **zero alerting or monitoring** beyond basic HTTP health checks (`/healthz`, `/setup/healthz`). The wrapper manages the OpenClaw gateway as a child process and reverse-proxies traffic, but does not monitor system-level security events or resource usage.

This plan introduces three security alert monitors plus additional recommendations, all designed to run inside the existing Express wrapper process without interfering with gateway operations.

---

## Notification Delivery Strategy

**Problem**: The OpenClaw gateway handles bot messaging but does not expose a documented REST API for sending arbitrary outbound messages from the wrapper.

**Solution**: Send alerts directly via channel-native APIs, reading credentials from the existing `openclaw.json` config:

| Channel  | Delivery Method                          | Config Source                            |
|----------|------------------------------------------|------------------------------------------|
| Telegram | `POST https://api.telegram.org/bot<token>/sendMessage` | `channels.telegram.botToken` in `openclaw.json` |
| Discord  | Discord Bot API `POST /channels/{id}/messages`          | `channels.discord.token` in `openclaw.json`     |
| Slack    | `POST https://slack.com/api/chat.postMessage`           | `channels.slack.botToken` in `openclaw.json`    |

A dedicated `ALERTS_CHAT_ID` / `ALERTS_CHANNEL_ID` env var specifies *where* to send alerts (Telegram chat ID, Discord channel ID, or Slack channel ID). This keeps alert routing separate from the bot's normal conversation channels.

**Fallback**: If no channel is configured, alerts are logged to stdout (captured by Railway's log drain) with a `[SECURITY-ALERT]` prefix for external log-based alerting.

---

## Alert 1: Failed SSH Login Detection

### Purpose
Detect brute-force SSH attacks and notify instantly when someone attempts unauthorized access.

### Detection Method
- **Primary**: Watch `/var/log/auth.log` using `fs.watch()` + incremental read (seek to last position)
- **Fallback**: If `/var/log/auth.log` is unavailable (common in containers), use `child_process.spawn("journalctl", ["-u", "sshd", "-f", "--no-pager", "-o", "short-iso"])` for real-time streaming
- **Container note**: Railway containers typically don't run sshd. If neither log source is available, this monitor logs a warning at startup and disables itself. It becomes relevant when the template is deployed on a VM or when SSH is enabled via the web TUI.

### Parsing Rules
Match lines containing any of:
- `Failed password for` — extract username, source IP
- `Invalid user` — extract attempted username, source IP
- `authentication failure` — generic PAM failure
- `Connection closed by authenticating user` — pre-auth disconnect (scan behavior)

### Aggregation & Debounce
- **Window**: 60 seconds (configurable via `ALERTS_SSH_WINDOW_SECONDS`)
- **Threshold**: 3 failed attempts from the same IP within the window (configurable via `ALERTS_SSH_THRESHOLD`)
- **Debounce**: After sending an alert for an IP, suppress duplicate alerts for that IP for 5 minutes
- **Batching**: Aggregate all attempts from the same IP in one message

### Alert Message
```
[SSH ALERT] Brute force detected
Source IP: 203.0.113.50
Failed attempts: 7 in 60s
Usernames tried: root, admin, ubuntu, deploy
First seen: 2026-02-22T14:30:00Z
Last seen: 2026-02-22T14:30:47Z
```

### Configuration
```env
ALERTS_SSH_ENABLED=true           # Enable SSH monitoring (default: true if log source exists)
ALERTS_SSH_THRESHOLD=3            # Failed attempts before alert
ALERTS_SSH_WINDOW_SECONDS=60      # Aggregation window
ALERTS_SSH_COOLDOWN_MINUTES=5     # Per-IP alert cooldown
```

---

## Alert 2: Disk Space Monitoring

### Purpose
Warn before disk fills up and causes gateway crashes, data loss, or failed writes.

### Detection Method
- Run `df --output=source,pcent,avail,size,target -x tmpfs -x devtmpfs` at regular intervals
- Parse output to get usage percentage per filesystem
- Focus on `/data` (Railway volume) and `/` (root filesystem)

### Thresholds (two tiers)
| Level    | Default | Behavior                         |
|----------|---------|----------------------------------|
| Warning  | 85%     | Informational alert              |
| Critical | 90%     | Urgent alert, shorter check interval switches to 1 min |

### Cooldown
- Don't re-alert for the **same filesystem at the same level** within 30 minutes
- Re-alert immediately if usage **increases by 5%+ since last alert**
- When usage drops below threshold, send a "resolved" message

### Schedule
- Normal: Every 5 minutes (configurable via `ALERTS_DISK_CHECK_INTERVAL_MINUTES`)
- Escalated: Every 1 minute when any filesystem is at critical level

### Alert Message
```
[DISK WARNING] /data at 91%
Filesystem: /dev/sda1 mounted on /data
Used: 18.2 GB / 20.0 GB
Available: 1.8 GB
Trend: +3% in last hour

Action: Free space or expand Railway volume
```

### Configuration
```env
ALERTS_DISK_ENABLED=true                  # Enable disk monitoring (default: true)
ALERTS_DISK_WARN_PERCENT=85               # Warning threshold
ALERTS_DISK_CRIT_PERCENT=90               # Critical threshold
ALERTS_DISK_CHECK_INTERVAL_MINUTES=5      # Normal check interval
ALERTS_DISK_COOLDOWN_MINUTES=30           # Alert cooldown per filesystem
```

---

## Alert 3: Daily Config Audit

### Purpose
Detect unauthorized or unexpected changes to critical configuration files. Every morning, compare current state against known-good baselines.

### Files to Monitor

**Application configs** (always monitored):
- `${OPENCLAW_STATE_DIR}/openclaw.json` — main OpenClaw configuration
- `${OPENCLAW_STATE_DIR}/gateway.token` — authentication token
- `${PROJECT_ROOT}/package.json` — dependency manifest
- `${PROJECT_ROOT}/Dockerfile` — container build definition
- `${PROJECT_ROOT}/railway.toml` — deployment configuration

**System configs** (monitored if readable):
- `/etc/passwd` — user accounts
- `/etc/group` — group memberships
- `/etc/shadow` — password hashes (if accessible)
- `/etc/ssh/sshd_config` — SSH configuration (if exists)
- `/etc/sudoers` — sudo permissions (if exists)

**Custom files** (via env var):
- `ALERTS_AUDIT_EXTRA_FILES` — comma-separated list of additional file paths

### Baseline Mechanism
1. On first run, compute SHA-256 hash of each monitored file
2. Store baselines in `${OPENCLAW_STATE_DIR}/alert-baselines.json`
3. Each entry stores: `{ path, hash, size, mtime, recordedAt }`
4. After each audit, update baselines to reflect current state (so tomorrow only shows new changes)
5. Provide a manual re-baseline command via `/setup/api/alerts/rebaseline`

### Diff Reporting
For text files that changed, include a summary:
- Lines added / removed / modified (count only, not content — avoid leaking secrets)
- File size delta
- Whether permissions changed

### Schedule
- Default: Daily at 06:00 UTC (configurable via `ALERTS_AUDIT_CRON`)
- Uses a simple `setInterval` + hour check rather than adding a cron dependency
- Also runs once at server startup (with a 60-second delay to let gateway stabilize)

### Alert Messages

**No changes detected**:
```
[CONFIG AUDIT] Daily report — all clear
All 12 monitored files match baseline.
Next audit: 2026-02-23 06:00 UTC
```

**Changes detected**:
```
[CONFIG AUDIT] Daily report — CHANGES DETECTED

Modified:
  /data/.openclaw/openclaw.json
    Size: 2,847 -> 3,102 bytes (+255)
    Lines: +8 added, -2 removed
  /etc/passwd
    Size: 1,204 -> 1,258 bytes (+54)
    Lines: +1 added (possible new user account)

New files:
  /etc/sudoers.d/90-custom (not previously tracked)

Missing files:
  (none)

Unchanged: 10 files
Next audit: 2026-02-23 06:00 UTC
```

### Configuration
```env
ALERTS_AUDIT_ENABLED=true                   # Enable config audit (default: true)
ALERTS_AUDIT_CRON="0 6 * * *"               # Cron expression for schedule
ALERTS_AUDIT_EXTRA_FILES=""                  # Additional files to monitor (comma-sep)
ALERTS_AUDIT_REPORT_ALL_CLEAR=true           # Send message even when no changes found
```

---

## Additional Recommendations

### 4. Gateway Crash Alerting

The wrapper already detects gateway exits (`server.js:236-248`) and auto-restarts. Add an alert notification on this existing code path.

**Trigger**: Gateway process exits unexpectedly (non-zero exit code or signal)
**Cooldown**: 1 alert per 10 minutes (avoid spam during crash loops)
**Message**:
```
[GATEWAY ALERT] Process exited unexpectedly
Exit code: 1 | Signal: null
Auto-restart: scheduled in 3s
Uptime before crash: 4h 23m
Recent log lines: (last 5 lines from ring buffer)
```

**Implementation**: ~10 lines added to the existing `gatewayProc.on("exit")` handler.

### 5. Setup Wizard Brute Force Detection

The wrapper already has rate limiting (`server.js:297-320` — 50 attempts/IP/60s). Add an alert when the rate limiter triggers or when multiple failed Basic auth attempts occur.

**Trigger**: 5+ failed auth attempts to `/setup` within 60 seconds from same IP
**Message**:
```
[AUTH ALERT] Setup wizard brute force
Source IP: 203.0.113.50
Failed attempts: 12 in 60s
Endpoint: /setup
Rate limited: yes
```

**Implementation**: Hook into the existing `authAttempts` Map tracking.

### 6. Outbound Connection Monitor (Stretch Goal)

Periodically run `ss -tunp` or `netstat` to detect unexpected outbound connections that could indicate a compromised container.

**Schedule**: Every 15 minutes
**Baseline**: Known-good connections (gateway, npm registry, channel APIs)
**Alert**: New outbound connections to unknown IPs/ports

---

## File Structure

```
src/
  server.js                    (existing — add alert init + gateway crash hook)
  alerts/
    index.js                   (orchestrator: init, shutdown, config loading)
    notifier.js                (send to Telegram/Discord/Slack or stdout fallback)
    scheduler.js               (interval-based scheduling, no external deps)
    state.js                   (baseline storage, cooldown tracking in JSON file)
    monitors/
      ssh-monitor.js           (Alert 1: watch auth.log / journalctl)
      disk-monitor.js          (Alert 2: periodic df parsing)
      config-audit.js          (Alert 3: SHA-256 baseline comparison)
      gateway-monitor.js       (Alert 4: hook into gateway exit events)
      auth-monitor.js          (Alert 5: setup wizard brute force)
```

### Dependencies

**No new npm dependencies required.** Everything uses Node.js built-ins:
- `node:fs` / `node:fs/promises` — file watching, reading, hashing
- `node:crypto` — SHA-256 for config audit baselines
- `node:child_process` — running `df`, `journalctl`
- `node:https` — sending alerts to Telegram/Discord/Slack APIs

This keeps the container image small and avoids supply-chain risk from additional packages.

---

## Integration Points with Existing Code

### 1. Server Startup (`server.js`)
```js
// After gateway starts, initialize alert system
import { initAlerts, shutdownAlerts } from "./alerts/index.js";

// In the listen callback:
initAlerts({ stateDir: STATE_DIR, gatewayToken: OPENCLAW_GATEWAY_TOKEN });

// In SIGTERM handler:
shutdownAlerts();
```

### 2. Gateway Crash Hook (`server.js:236-248`)
```js
gatewayProc.on("exit", (code, signal) => {
  // ... existing code ...
  alertOnGatewayCrash({ code, signal, recentLogs: gatewayLogs.slice(-5) });
});
```

### 3. Auth Failure Hook (`server.js` — setup auth middleware)
```js
// After failed Basic auth:
alertOnAuthFailure({ ip: req.ip, endpoint: req.path });
```

### 4. Config Reading
The notifier reads channel credentials from `openclaw.json` via:
```js
const config = JSON.parse(fs.readFileSync(configPath(), "utf8"));
const telegramToken = config.channels?.telegram?.botToken;
```

### 5. Setup Wizard UI (optional)
Add an "Alerts" tab to `/setup` showing:
- Which monitors are active
- Recent alert history (last 20 alerts from an in-memory ring buffer)
- Manual trigger buttons for testing
- Re-baseline button for config audit

---

## Environment Variable Summary

| Variable | Default | Description |
|----------|---------|-------------|
| `ALERTS_ENABLED` | `true` | Master switch for all alerts |
| `ALERTS_CHANNEL` | `auto` | Which channel to send alerts: `auto` / `telegram` / `discord` / `slack` / `stdout` |
| `ALERTS_CHAT_ID` | — | **Required if using Telegram**: target chat/group ID |
| `ALERTS_CHANNEL_ID` | — | **Required if using Discord/Slack**: target channel ID |
| `ALERTS_SSH_ENABLED` | `true` | Enable failed SSH login detection |
| `ALERTS_SSH_THRESHOLD` | `3` | Failed attempts before alerting |
| `ALERTS_SSH_WINDOW_SECONDS` | `60` | Aggregation window |
| `ALERTS_SSH_COOLDOWN_MINUTES` | `5` | Per-IP cooldown |
| `ALERTS_DISK_ENABLED` | `true` | Enable disk space monitoring |
| `ALERTS_DISK_WARN_PERCENT` | `85` | Warning threshold |
| `ALERTS_DISK_CRIT_PERCENT` | `90` | Critical threshold |
| `ALERTS_DISK_CHECK_INTERVAL_MINUTES` | `5` | Check frequency |
| `ALERTS_DISK_COOLDOWN_MINUTES` | `30` | Per-filesystem cooldown |
| `ALERTS_AUDIT_ENABLED` | `true` | Enable daily config audit |
| `ALERTS_AUDIT_CRON` | `0 6 * * *` | Audit schedule (parsed manually, not a real cron lib) |
| `ALERTS_AUDIT_EXTRA_FILES` | — | Additional files to audit (comma-separated) |
| `ALERTS_AUDIT_REPORT_ALL_CLEAR` | `true` | Send message even when nothing changed |

---

## Constraints & Design Decisions

1. **No new npm dependencies** — uses only Node.js built-in modules to avoid supply-chain risk and keep the Docker image small.

2. **No overlap with OpenClaw gateway** — alerts run entirely in the wrapper process. The gateway is unaware of the alert system. Alert messages go directly to channel APIs, not through the gateway's bot message flow.

3. **Graceful degradation** — if a monitor can't access its data source (e.g., no auth.log in container), it logs a warning and disables itself rather than crashing.

4. **Persistent state on volume** — baselines and cooldown timestamps are stored in `${OPENCLAW_STATE_DIR}/alert-state.json`, surviving container restarts via the Railway volume at `/data`.

5. **Minimal server.js changes** — the alert system is a self-contained module under `src/alerts/`. Only 3 integration points touch `server.js`: init, shutdown, and gateway crash hook.

6. **Stdout fallback** — all alerts are always logged to stdout with a `[SECURITY-ALERT]` prefix regardless of channel configuration, ensuring Railway's log drain captures them even if channel delivery fails.

---

## Implementation Order

| Phase | Items | Rationale |
|-------|-------|-----------|
| 1 | `notifier.js`, `state.js`, `scheduler.js`, `index.js` | Core infrastructure first |
| 2 | `disk-monitor.js` | Easiest to test, most universally applicable |
| 3 | `config-audit.js` | Straightforward file hashing |
| 4 | `ssh-monitor.js` | Requires log source detection, more complex parsing |
| 5 | `gateway-monitor.js` + `auth-monitor.js` | Hooks into existing code |
| 6 | Setup wizard UI additions | Optional, nice-to-have |
