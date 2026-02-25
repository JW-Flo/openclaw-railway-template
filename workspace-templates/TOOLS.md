# Available Tools

## CLI Tools
- **gh** — GitHub CLI for repo management, PRs, issues, releases
- **wrangler** — Cloudflare Workers CLI for deployment and D1/KV/R2 management
- **railway** — Railway CLI for deployment and service management
- **jq** — JSON processor for parsing API responses
- **git** — Version control
- **node/npm** — Node.js runtime and package manager

## Environment Variables Available
- `GH_PAT` — GitHub Personal Access Token (repo scope)
- `OPENROUTER_API_TOKEN` — OpenRouter API key for multi-model access
- `ANTHROPIC_API_KEY` — Anthropic API key
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account identifier
- `RAILWAY_ACCOUNT_TOKEN` — Railway API token
- `TELEGRAM_API_ID` — Telegram API ID
- `TELEGRAM_API_HASH` — Telegram API hash
- `GROK_API_KEY` — Grok API key

## Skills (OpenClaw Agent Skills)

Skills extend the agent's capabilities with specialized behaviors. They are loaded from SKILL.md files and injected into the system prompt.

### Skill Locations (highest to lowest precedence)
1. **Workspace skills**: `/data/workspace/skills/` — per-agent, highest priority
2. **Managed skills**: `~/.openclaw/skills/` — shared across workspaces
3. **Bundled skills**: shipped with OpenClaw installation

### Managing Skills
```bash
# List all available skills
openclaw skills list
# List only eligible (runnable) skills
openclaw skills list --eligible
# Check skill requirements
openclaw skills check
# Get info about a skill
openclaw skills info <skill-name>
# Install from GitHub
openclaw skills install github:user/skill-name
```

### ClawHub (Skills Marketplace)
```bash
# Search for skills
clawhub search <query>
# Install a skill from ClawHub
clawhub install <slug>
# List installed ClawHub skills
clawhub list
# Update all installed skills
clawhub update --all
```

### Custom Skills (workspace-specific)

These skills are tailored to the managed projects and deploy workflows:

| Skill | Description |
|-------|-------------|
| `project-ops` | Fleet-wide git operations: sync, status, branch management across all 4 repos |
| `market-agents` | Trading bot management: positions, signals, SQLite queries, health checks |
| `deploy-pipeline` | Railway & Cloudflare CI/CD: deploy, verify, rollback, env var management |

### Creating New Custom Skills
Place a directory in `/data/workspace/skills/<skill-name>/` with a `SKILL.md` file:
```yaml
---
name: my-skill
description: What the skill does
---
Instructions for the agent when this skill is active...
```

## Common Workflows

### Check project health
```bash
cd /data/workspace/<project>
git pull origin main
npm install
npm test
npm run lint
```

### Create a PR
```bash
gh pr create --title "feat: description" --body "Summary of changes"
```

### Deploy to Cloudflare
```bash
cd /data/workspace/<project>
wrangler deploy
```

### Deploy to Railway
```bash
railway up
```
