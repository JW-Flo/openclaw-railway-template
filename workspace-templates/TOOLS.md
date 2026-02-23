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
