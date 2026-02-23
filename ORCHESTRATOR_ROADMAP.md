# OpenClaw Orchestrator Agent — Development Roadmap

> **Purpose**: This document defines the roadmap for configuring and extending this OpenClaw instance as a **project orchestrator agent** — a persistent AI assistant that manages development, maintenance, and improvement across multiple open projects via Claude Code.
>
> **Use as a prompt**: Copy/paste this into a new Claude Code session to bootstrap context.

---

## Current State

### OpenClaw Instance

- **Deployed at**: `https://openclaw-production-4e3d.up.railway.app`
- **Version**: OpenClaw 2026.2.15
- **AI Provider**: Anthropic (Claude, API key)
- **Gateway Auth**: Bearer token (auto-injected by wrapper)
- **Control UI**: `/openclaw` (no user auth needed — wrapper injects token)
- **Setup Wizard**: `/setup` (Basic auth with `SETUP_PASSWORD`)
- **Persistence**: Railway Volume at `/data` (config, credentials, workspace, memory)
- **Channels**: None configured yet (Telegram planned)

### Managed Projects

| Project | Type | Stack | Repo Visibility | Hosting |
|---------|------|-------|-----------------|---------|
| **Atlas-IT** | Edge-native IT ops automation | Cloudflare Workers, TypeScript, D1/KV/R2, SvelteKit | Private | Cloudflare |
| **AWhittleWandering** | Live journey tracking platform | React, TypeScript, Vite, Mapbox, Cloudflare Workers + Hono, D1/R2 | Public | Cloudflare |
| **Market Agents** | Autonomous trading bot | TypeScript, Node.js, SQLite, Kalshi/Polymarket APIs | Private | Railway |
| **JW-Site** | Front-end prototyping / staging | SvelteKit | Public | N/A (staging) |

---

## Architecture Vision

```
                        ┌─────────────────────────┐
   Telegram/Discord ──> │   OpenClaw Gateway       │
   Control UI ────────> │   (port 18789)           │
   Scheduled Jobs ────> │                          │
                        └──────────┬───────────────┘
                                   │
                        ┌──────────▼───────────────┐
                        │   Orchestrator Agent      │
                        │   (AGENTS.md + SOUL.md)   │
                        │                          │
                        │  ┌─ Memory (per-project) │
                        │  ├─ Skills (custom)      │
                        │  ├─ Plugins (enabled)    │
                        │  └─ Tools (shell, code)  │
                        └──────────┬───────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
     ┌────────▼──────┐   ┌────────▼──────┐   ┌─────────▼─────┐
     │  Atlas-IT      │   │  AWW          │   │  Market Agent │
     │  (git clone)   │   │  (git clone)  │   │  (git clone)  │
     │  wrangler dev  │   │  vite dev     │   │  npm test     │
     └────────────────┘   └───────────────┘   └───────────────┘
```

The agent operates as a **hub** that:
1. Receives instructions via Telegram DM, Discord, or the Control UI
2. Clones/pulls the target project repo into its workspace
3. Runs Claude Code-style development tasks (read, edit, test, commit, push)
4. Reports back results and creates PRs on GitHub
5. Maintains per-project memory and context across sessions

---

## Roadmap

### Phase 0: Foundation (Current Sprint)

**Goal**: Get the gateway running and basic agent accessible.

- [x] Deploy OpenClaw on Railway with persistent volume
- [x] Configure Anthropic API key via setup wizard
- [x] Fix gateway startup (`gateway.mode`, credentials dir)
- [x] Add diagnostic endpoints and log capture
- [ ] Verify gateway is healthy and Control UI loads at `/openclaw`
- [ ] Configure Telegram bot channel for mobile access
- [ ] Test basic agent interaction (ask it a question, verify response)

### Phase 1: Workspace & Project Bootstrap

**Goal**: Set up the workspace so the agent can access and work on all projects.

**Tasks**:
1. **Configure GitHub credentials** in the agent workspace
   - Store a GitHub PAT (with repo scope) so the agent can clone, push, and create PRs
   - `openclaw config set` or place credentials in workspace
2. **Clone all project repos** into the workspace
   ```
   /data/workspace/
   ├── Project-AtlasIT/
   ├── AWhittleWandering/
   ├── market_agents/
   └── JW-Site/
   ```
3. **Create per-project AGENTS.md files** in each repo (if not present)
   - Define project-specific coding conventions, test commands, deploy procedures
4. **Configure the orchestrator's MEMORY.md**
   - Project registry: names, repos, tech stacks, current priorities
   - Cross-project dependencies and shared patterns
   - Owner preferences (commit style, PR conventions, review process)
5. **Configure SOUL.md** for orchestrator personality
   - Professional, concise, proactive about tests and CI
   - Always creates branches and PRs (never pushes to main directly)
   - Reports progress via Telegram

**Acceptance**: Agent can `git pull`, run tests, and `git push` on each project when asked.

### Phase 2: Channel Integration & Notifications

**Goal**: Interact with the agent naturally from mobile/desktop.

**Tasks**:
1. **Set up Telegram bot** via @BotFather
   - Create bot, get token, configure via `/setup` wizard
   - Approve DM pairing via `/setup/api/pairing/approve`
2. **Configure notification patterns**
   - Agent sends daily digest of project health (test status, open PRs, dependency updates)
   - Alert on CI failures or security advisories
3. **Define command shortcuts** the agent understands
   - "check atlas" → pull latest, run tests, report status
   - "deploy aww" → run build, verify, push to production branch
   - "market status" → check trading bot health, recent PnL, any errors

**Acceptance**: Can message the agent on Telegram, ask it to work on a project, and receive results.

### Phase 3: Custom Skills & Automation

**Goal**: Extend the agent with project-specific skills.

**Skills to build**:

1. **`project-switch`** — Context-switch between projects
   - Load project-specific AGENTS.md and memory
   - Set working directory to the right repo
   - Load relevant environment variables

2. **`health-check`** — Run comprehensive project health checks
   - Pull latest code from all repos
   - Run each project's test suite
   - Check for outdated dependencies (`npm outdated`, etc.)
   - Report results in a structured format

3. **`pr-manager`** — GitHub PR workflow automation
   - Create feature branches with conventional naming
   - Generate PR descriptions from commit history
   - Auto-request reviews
   - Track PR status across all projects

4. **`deploy-guard`** — Safe deployment workflow
   - Pre-deploy checklist (tests pass, no lint errors, version bumped)
   - For Cloudflare projects: `wrangler deploy` with dry-run first
   - For Railway projects: trigger deploy via Railway API
   - Post-deploy health check

5. **`dependency-watch`** — Automated dependency management
   - Weekly scan for outdated/vulnerable deps
   - Create update PRs with test verification
   - Track security advisories

**Acceptance**: Skills are loadable and the agent can run multi-step workflows autonomously.

### Phase 4: Scheduled Automation & Reporting

**Goal**: The agent works proactively, not just reactively.

**Automations**:

1. **Daily (8am)**:
   - Pull all repos, run tests
   - Check GitHub notifications/issues
   - Send Telegram digest: "All green" or list of failures

2. **Weekly (Monday 9am)**:
   - Dependency audit across all projects
   - Generate summary of week's commits/PRs across all repos
   - Suggest maintenance tasks

3. **On Push (webhook)**:
   - Run tests on pushed branch
   - If failing, attempt auto-fix and push correction
   - Notify via Telegram with results

4. **On Issue Created (webhook)**:
   - Triage GitHub issues: label, assign priority
   - For bug reports: attempt to reproduce, suggest fix
   - For feature requests: create implementation plan

**Acceptance**: Agent operates autonomously on schedule and responds to webhooks.

### Phase 5: Multi-Agent Coordination

**Goal**: Specialized sub-agents for different concerns.

**Architecture**:
- **Orchestrator Agent** (this instance): Routes tasks, maintains global state
- **Code Agent**: Focused on reading/writing code, running tests
- **DevOps Agent**: Handles deployments, infrastructure, monitoring
- **Research Agent**: Analyzes codebases, writes documentation, answers questions

Configure via OpenClaw's subagent system:
- `OPENCLAW_SUBAGENT_MAX_CONCURRENT=8` (already set)
- `OPENCLAW_MAX_CONCURRENT=4` (already set)

**Acceptance**: Agent can delegate work to sub-agents and coordinate results.

---

## Configuration Reference

### Environment Variables (Railway)

```env
# Required
SETUP_PASSWORD=<setup-wizard-password>
OPENCLAW_GATEWAY_TOKEN=<auto-generated>

# Recommended
OPENCLAW_STATE_DIR=/data/.openclaw
OPENCLAW_WORKSPACE_DIR=/data/workspace
PORT=8080

# Agent tuning
OPENCLAW_MAX_CONCURRENT=4
OPENCLAW_SUBAGENT_MAX_CONCURRENT=8
OPENCLAW_COMPACTION_MODE=auto
```

### Key Files in Workspace

```
/data/workspace/
├── AGENTS.md           # Orchestrator behavior definition
├── SOUL.md             # Personality and communication style
├── MEMORY.md           # Project registry, preferences, facts
├── memory/
│   └── YYYY-MM-DD.md   # Daily interaction logs
├── LOG_PROJECTS.md     # Project ID registry
├── LOG_CHARTERS.md     # Project charters and objectives
├── Project-AtlasIT/    # Cloned repo
├── AWhittleWandering/  # Cloned repo
├── market_agents/      # Cloned repo
└── JW-Site/            # Cloned repo
```

### Useful OpenClaw CLI Commands

```bash
# Check agent health
openclaw doctor --non-interactive --repair

# Set AI model
openclaw models set anthropic/claude-sonnet-4-20250514

# Add Telegram channel
openclaw channels add --channel telegram --token <BOT_TOKEN>

# Approve DM pairing
openclaw pairing approve telegram <CODE>

# View config
openclaw config get gateway
openclaw config get channels

# Gateway management
openclaw gateway run --bind loopback --port 18789 --auth token
```

### API Endpoints (this wrapper)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/setup` | GET | Basic | Setup wizard UI |
| `/setup/api/status` | GET | Basic | Config and auth status |
| `/setup/api/run` | POST | Basic | Run onboarding |
| `/setup/api/debug` | GET | Basic | Debug info + gateway logs |
| `/setup/api/doctor` | POST | Basic | Run doctor --repair |
| `/setup/api/reset` | POST | Basic | Delete config, start over |
| `/setup/api/restart-gateway` | POST | Basic | Force gateway restart |
| `/setup/api/gateway-help` | GET | Basic | Show gateway CLI help |
| `/setup/api/config-get` | POST | Basic | Read gateway config |
| `/setup/api/pairing/approve` | POST | Basic | Approve channel pairing |
| `/openclaw` | GET | None | Control UI (token auto-injected) |
| `/healthz` | GET | None | Health check |
| `/setup/healthz` | GET | None | Detailed health check |

---

## Immediate Next Steps

1. **Get gateway running** — Monitor Railway redeploy, check `/setup/api/debug` for `gatewayLogs`
2. **Create Telegram bot** — Message @BotFather, get token, configure via setup wizard
3. **Set up GitHub access** — Store PAT in agent workspace for repo operations
4. **Write AGENTS.md** — Define the orchestrator's behavior, project awareness, and workflow rules
5. **Clone projects** — Pull all repos into `/data/workspace/`
6. **Test end-to-end** — Message agent via Telegram: "check atlas-it tests" → agent pulls, tests, reports

---

## Open Questions

- **Model selection**: Claude Sonnet 4 (fast, cheap) vs Claude Opus 4 (deep reasoning)? Consider Sonnet for routine tasks, Opus for complex refactoring.
- **Cost management**: Monitor Anthropic API usage. Consider OpenRouter as a fallback for cost optimization.
- **Security**: The agent will have GitHub push access to all repos. Define branch protection rules and PR-only merge policies to prevent accidental damage.
- **Scaling**: Railway free tier may not have enough resources for concurrent sub-agents. Monitor memory/CPU usage.
- **Telegram bot token**: Need to create one via @BotFather and configure it.

---

*Last updated: 2026-02-23*
*OpenClaw version: 2026.2.15*
*Session: https://claude.ai/code/session_01TXe1KLYUAanPaYurDKEuvu*
