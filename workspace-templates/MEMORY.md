# Project Registry

## Managed Projects

| Project | Repo | Stack | Hosting | Status |
|---------|------|-------|---------|--------|
| Atlas-IT | JW-Flo/Project-AtlasIT | Cloudflare Workers, TypeScript, D1/KV/R2, SvelteKit | Cloudflare | Active |
| AWhittleWandering | JW-Flo/AWhittleWandering | React, TypeScript, Vite, Mapbox, CF Workers + Hono, D1/R2 | Cloudflare | Active |
| Market Agents | JW-Flo/market_agents | TypeScript, Node.js, SQLite, Kalshi/Polymarket APIs | Railway | Active |
| JW-Site | JW-Flo/JW-Site | SvelteKit | N/A (staging) | Active |

## Cross-Project Notes
- Atlas-IT and AWhittleWandering both deploy to Cloudflare
- Market Agents runs on Railway (same platform as this orchestrator)
- JW-Site is a prototyping/staging environment

## Known Cross-Project Failure Patterns

| Pattern | Projects Affected | Root Cause | Prevention |
|---------|------------------|------------|------------|
| Auth/session 401s | openclaw, market_agents | UI calls API without required auth headers | One canonical auth gate per project accepting all valid credential types |
| Automation feedback loops | Project-AtlasIT | Workflows committing artifacts trigger themselves on `push: [main]` | Use `workflow_dispatch` only; add CI linter |
| Health check misrouting | AWhittleWandering | `workers_dev = false` disables expected probe URL | Compute URLs from wrangler output, not static strings |
| Error counter bugs | market_agents | `consecutiveErrors` reset on partial success | Reset only on full cycle completion; store `lastErrorAt` |
| Gateway boot race | openclaw | Dashboard hit before gateway is ready | Wait for `/setup/healthz` to show gateway running |

## Recent Activity
<!-- Updated automatically by the agent -->
