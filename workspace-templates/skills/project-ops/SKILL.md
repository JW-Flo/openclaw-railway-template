---
name: project-ops
description: Multi-project git operations across all managed repositories. Use when syncing, checking status, creating branches, running builds/tests, or managing PRs across Project-AtlasIT, AWhittleWandering, market_agents, and JW-Site.
metadata: {"clawdbot":{"emoji":"📂","requires":{"bins":["git","gh"]}}}
---

# Project Ops

Manage all workspace repositories as a fleet. Each project lives under `/data/workspace/`.

## Managed Projects

| Project | Repo | Stack | Path |
|---------|------|-------|------|
| Atlas-IT | `JW-Flo/Project-AtlasIT` | Node.js monorepo (auth, marketplace, AI orchestrator, APIs) | `/data/workspace/Project-AtlasIT` |
| AWhittleWandering | `JW-Flo/AWhittleWandering` | Node.js monorepo (frontend, edge-worker, shared) | `/data/workspace/AWhittleWandering` |
| Market Agents | `JW-Flo/market_agents` | TypeScript (Kalshi trading, Polymarket polling, SQLite) | `/data/workspace/market_agents` |
| JW-Site | `JW-Flo/JW-Site` | Monorepo (Astro/SvelteKit apps, Cloudflare Pages) | `/data/workspace/JW-Site` |

## Commands

### Fleet Status (run for all projects)
```bash
for dir in Project-AtlasIT AWhittleWandering market_agents JW-Site; do
  echo "=== $dir ==="
  cd /data/workspace/$dir
  echo "Branch: $(git branch --show-current)"
  echo "Status: $(git status --short | wc -l) dirty files"
  echo "Last commit: $(git log -1 --oneline)"
  echo "Behind origin: $(git rev-list HEAD..origin/$(git branch --show-current) --count 2>/dev/null || echo 'unknown')"
  echo ""
done
```

### Sync All (pull latest main)
```bash
for dir in Project-AtlasIT AWhittleWandering market_agents JW-Site; do
  echo "=== Syncing $dir ==="
  cd /data/workspace/$dir
  git fetch origin main && git pull origin main
done
```

### Health Check (build + test where available)
```bash
for dir in Project-AtlasIT AWhittleWandering market_agents JW-Site; do
  echo "=== $dir ==="
  cd /data/workspace/$dir
  if [ -f package.json ]; then
    npm install --silent 2>&1 | tail -3
    npm run build 2>&1 | tail -5
    npm test 2>&1 | tail -10
  fi
done
```

### Create Feature Branch (all projects)
```bash
BRANCH="feat/description"
for dir in Project-AtlasIT AWhittleWandering market_agents JW-Site; do
  cd /data/workspace/$dir
  git checkout -b "$BRANCH"
done
```

## When to Use

- User asks to "sync all projects" or "pull latest"
- User asks "what's the status of my repos"
- User wants to run tests/builds across everything
- User asks to create matching branches across repos
- User asks about open PRs or issues across repos

## When NOT to Use

- Single-project work (just `cd` to the project)
- Detailed code review (use `github` skill)
- Deployment (use `deploy-pipeline` skill)

## Tips

- Always `git fetch` before checking if repos are behind
- Use `gh pr list --repo JW-Flo/<repo>` to check open PRs per project
- Use `gh issue list --repo JW-Flo/<repo>` for outstanding issues
- For cross-project search: `grep -r "pattern" /data/workspace/*/src/`
