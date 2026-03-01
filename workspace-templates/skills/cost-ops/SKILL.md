---
name: cost-ops
description: Cost tracking and budget management — check spending summaries, review daily costs, monitor budget alerts, and suggest model tier changes based on usage patterns.
metadata: {"clawdbot":{"emoji":"💰","requires":{"bins":["curl"],"env":["SETUP_PASSWORD"]}}}
---

# Cost Operations

Monitor LLM spending and manage budget alerts for the JClaw/OpenClaw instance through wrapper API endpoints.

## Wrapper API Endpoints

All endpoints require Basic auth with `SETUP_PASSWORD`:

```bash
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="${OPENCLAW_BASE_URL:-https://openclaw-production-4e3d.up.railway.app}"
```

### Daily Cost Breakdown

```bash
# Get daily aggregates for last 30 days (default)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/costs?days=30"

# Get daily aggregates for last 7 days
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/costs?days=7"
```

Returns: array of `{ date, total_cost, total_input, total_output, requests }` per day.

### Monthly Summary

```bash
# Get current month total with per-model breakdown
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/costs/summary"
```

Returns: `{ month, total_cost, total_input, total_output, requests, by_model: { model: { cost, requests } } }`.

### Model Pool & Tier Management

```bash
# View current model pool config (tiers, limits, usage)
curl -s -H "Authorization: Basic $AUTH" "$BASE/setup/api/scheduler/pool"

# Update model pool settings
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/scheduler/pool" \
  -d '{"models":[...],"scheduler":{...}}'
```

## Budget Configuration

Set these environment variables on Railway:

| Variable | Description |
|----------|-------------|
| `BUDGET_ALERT_USD` | Monthly budget threshold in USD (triggers alert when exceeded) |
| `BUDGET_ALERT_WEBHOOK` | Optional webhook URL for budget alerts |

```bash
# Set budget alert at $10/month
curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/railway/env" \
  -d '{"variables":{"BUDGET_ALERT_USD":"10"}}'
```

Budget checks run at most once per minute. When the monthly total exceeds the threshold, alerts are sent via Telegram (if configured) and the optional webhook.

## Cost Optimization Strategies

Based on usage patterns, recommend these model tier adjustments:

1. **High free-tier usage (>80% of limit)**: Suggest increasing daily limits for free models or adding more free-tier models to the pool.

2. **Premium tier overuse**: If premium models handle >30% of requests, suggest:
   - Adjusting triage thresholds to route more to economy/standard
   - Enabling cost-optimized scheduler strategy
   - Setting stricter `maxTaskPriority` on premium models

3. **Low utilization**: If daily usage is consistently <10% of limits, suggest reducing `dailyLimit` to prevent accidental runaway.

4. **Budget approaching**: If monthly spend is >75% of budget with days remaining, suggest temporarily disabling premium models.

## Diagnostic Workflow

When investigating cost concerns:

1. **Check summary**: `GET /setup/api/costs/summary` — current month total
2. **Check daily trend**: `GET /setup/api/costs?days=7` — identify spikes
3. **Check model pool**: `GET /setup/api/scheduler/pool` — see per-model usage
4. **Check triage**: Review recent activity for triage decisions that escalated unnecessarily
5. **Adjust**: Update model pool, scheduler strategy, or budget alerts

## When to Use

- User asks about spending or costs
- User wants to set or adjust budget alerts
- User wants to optimize model selection for cost
- User notices unexpected spending increases
- Monthly budget reviews

## When NOT to Use

- Infrastructure management (use `railway-ops`)
- Security concerns (use `security-ops`)
- Backup management (use `backup-ops`)
