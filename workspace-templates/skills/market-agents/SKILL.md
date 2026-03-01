---
name: market-agents
description: Manage the Market Agents autonomous trading bot — check positions, view signals, monitor health, inspect SQLite data, and troubleshoot the Kalshi/Polymarket trading system.
metadata: {"clawdbot":{"emoji":"📈","requires":{"bins":["node","sqlite3"]}}}
---

# Market Agents

Autonomous trading bot at `/data/workspace/market_agents`. Runs as a persistent Railway service with three subsystems.

## Architecture

```
src/
  index.ts           — Entry point, init DB, start scheduler
  config.ts          — Environment variables
  db.ts              — SQLite connection + schema migration
  scheduler.ts       — Wires cron jobs
  kalshi/
    auth.ts          — RSA-PSS request signing
    client.ts        — REST client with retry/backoff
    trader.ts        — Order execution from signals
    positions.ts     — Position sync, fill tracking
    poller.ts        — Market data collection
    websocket.ts     — Live market streaming
  poller/
    orchestrator.ts  — Polymarket polling orchestrator
    circuit-breaker.ts — Fault tolerance
    stale-detector.ts  — Data freshness checks
  agents/
    specialists.ts         — Specialist trading agents
    research-orchestrator.ts — Research coordination
  analytics/
    metrics.ts       — Performance metrics
    optimizer.ts     — Strategy optimization
  clawnch/
    launcher.ts      — Token launch on Base via @clawnch/sdk
    fees.ts          — Fee claiming
  streams/
    manager.ts       — Event stream management
  dashboard/
    routes.ts        — Dashboard HTTP routes
    password-rotation.ts — Dashboard auth
  utils/
    logger.ts        — Structured JSON logger
    safety.ts        — Kill-switch, balance checks, rate limiter
```

## Common Operations

### Check Trading Status
```bash
cd /data/workspace/market_agents
# Check if the bot is running on Railway (set MARKET_AGENTS_URL to your deployed URL)
curl -s "${MARKET_AGENTS_URL:-https://market-agents-production.up.railway.app}/health" 2>/dev/null || echo "Not reachable externally"
```

### Inspect SQLite Database
```bash
cd /data/workspace/market_agents
# List tables
sqlite3 data/market_agents.db ".tables"
# Recent Kalshi fills
sqlite3 data/market_agents.db "SELECT * FROM kalshi_fills ORDER BY created_at DESC LIMIT 10;"
# Polymarket snapshots
sqlite3 data/market_agents.db "SELECT * FROM polymarket_snapshots ORDER BY polled_at DESC LIMIT 5;"
# Arbitrage signals
sqlite3 data/market_agents.db "SELECT * FROM arb_signals ORDER BY detected_at DESC LIMIT 10;"
# Position summary
sqlite3 data/market_agents.db "SELECT market_ticker, side, quantity, avg_price FROM positions WHERE quantity > 0;"
```

### Run Tests
```bash
cd /data/workspace/market_agents
npm test           # vitest run
npm run test:watch # vitest watch mode
```

### Build
```bash
cd /data/workspace/market_agents
npm run build      # tsc
```

### Check Logs (via Railway)
```bash
# Use Railway CLI if token is set
railway logs --service market-agents 2>/dev/null || echo "Use Railway dashboard"
```

## Safety Mechanisms

The bot has built-in safety:
- **Kill-switch**: Can halt all trading instantly
- **Balance checks**: Won't trade if balance drops below threshold
- **Rate limiter**: Prevents API abuse
- **Circuit breaker**: Stops polling on repeated failures
- **Stale detector**: Alerts when data freshness degrades

## When to Use

- User asks about trading positions, fills, or PnL
- User wants to check arbitrage signals or market data
- User needs to inspect the SQLite database
- User asks about bot health or wants to troubleshoot errors
- User wants to modify trading parameters or strategy
- User asks to run tests or build the project

## When NOT to Use

- General web search (use `web-search`)
- GitHub PR management (use `github` skill)
- Deploying the bot (use `deploy-pipeline`)
- Non-trading questions

## Known Failure Patterns

### Dashboard/API Auth 401s
- **Symptom**: Dashboard UI constantly receives 401, degrades to fallback behavior
- **Cause**: Auth header omission after SPA redirect or JWT auth migration
- **Fix**: Ensure every dashboard API call includes the correct auth header (cookie or bearer token)

### Error Counter Bug (auto-pause logic)
- **Symptom**: Bot never auto-pauses despite repeated failures, or pauses unexpectedly
- **Cause**: `consecutiveErrors` counter resets on partial success instead of full cycle completion
- **Fix**: Store `consecutiveErrors` + `lastErrorAt`; reset only when a complete trading cycle succeeds
- **Verify**: Check `utils/safety.ts` for counter reset logic

### External API Failures
- All external calls (Kalshi, Polymarket, news APIs) must have:
  - Timeouts (prevent hanging connections)
  - Jittered retries with exponential backoff
  - Structured logging via `utils/logger.ts` (never `console.log`)
  - Audit log entry on every side-effecting step (order placement, cancel, credential change)

### Safety Invariants (merge-blocking)
Any PR that modifies these must be explicitly reviewed and approved:
- Kill switch (`utils/safety.ts`)
- Max position sizing limits
- Daily loss limits
- Balance check thresholds
- Audit logging behavior

## Key Environment Variables (set on Railway)

- `KALSHI_API_KEY` — Kalshi API credentials
- `KALSHI_PRIVATE_KEY` — RSA private key for signing
- `DATABASE_URL` — SQLite path
- `DASHBOARD_PASSWORD` — Dashboard auth
