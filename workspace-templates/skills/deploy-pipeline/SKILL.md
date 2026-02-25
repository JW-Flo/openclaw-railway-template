---
name: deploy-pipeline
description: Railway and Cloudflare deployment pipelines for all managed projects. Use when deploying, checking deployment status, managing environment variables, or troubleshooting failed deployments.
metadata: {"clawdbot":{"emoji":"🚀","requires":{"bins":["gh"]}}}
---

# Deploy Pipeline

Deployment workflows for the managed project fleet across Railway and Cloudflare.

## Project Deployment Map

| Project | Platform | Deploy Method | Trigger |
|---------|----------|---------------|---------|
| OpenClaw Wrapper | Railway (Docker) | Push to `main` | Auto-deploy on merge |
| Market Agents | Railway (Node.js) | Push to `main` | Auto-deploy on merge |
| Atlas-IT | Cloudflare Pages + Railway | `wrangler deploy` / push | Manual + auto |
| AWhittleWandering | Cloudflare Workers | `wrangler deploy` | Manual |
| JW-Site | Cloudflare Pages | Push to `main` | Auto-deploy |

## Railway Deployment

### OpenClaw Wrapper (this repo)

The standard PR workflow — all code changes go through review:

```bash
# 1. Develop on feature branch
git checkout -b claude/<description>-<sessionId>

# 2. Lint
npm run lint

# 3. Commit and push
git add <files>
git commit -m "feat: description"
git push -u origin claude/<description>-<sessionId>

# 4. Create PR via GitHub API
GH_PAT="${GH_PAT}"
curl -s -X POST "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls" \
  -H "Authorization: token ${GH_PAT}" -H "Content-Type: application/json" \
  -d '{"title":"PR title","body":"## Summary\n- ...","head":"branch-name","base":"main"}'

# 5. Request Copilot review
curl -s -X POST -H "Authorization: token ${GH_PAT}" -H "Content-Type: application/json" \
  "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls/NUMBER/requested_reviewers" \
  -d '{"reviewers":["Copilot"]}'

# 6. Wait ~60s, check review, fix findings, then merge
curl -s -X PUT -H "Authorization: token ${GH_PAT}" -H "Content-Type: application/json" \
  "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls/NUMBER/merge" \
  -d '{"merge_method":"squash"}'
```

Railway auto-deploys from main (~60-90s Docker build).

### Set Railway Environment Variables
```bash
curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer ${RAILWAY_ACCOUNT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { variableUpsert(input: { projectId: \"PROJECT_ID\", environmentId: \"ENV_ID\", serviceId: \"SERVICE_ID\", name: \"VAR_NAME\", value: \"VAR_VALUE\" }) }"}'
```

**OpenClaw Railway IDs:**
- Project: `c57527ed-e599-42da-8f49-7fb30c6c4166`
- Service: `dac5966e-646e-4644-b3e9-cd31352f696d`
- Environment: `7932450e-bf32-4428-905e-de0c3dff381f`

### Check Railway Deployment Status
```bash
curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer ${RAILWAY_ACCOUNT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { deployments(first: 3, input: { projectId: \"c57527ed-e599-42da-8f49-7fb30c6c4166\", environmentId: \"7932450e-bf32-4428-905e-de0c3dff381f\", serviceId: \"dac5966e-646e-4644-b3e9-cd31352f696d\" }) { edges { node { id status createdAt } } } }"}'
```

## Cloudflare Deployment

### Deploy a Worker
```bash
cd /data/workspace/<project>
wrangler deploy
```

### Deploy to Cloudflare Pages
```bash
cd /data/workspace/<project>
npm run build
wrangler pages deploy <build-output-dir> --project-name <pages-project>
```

### Check Deployment Logs
```bash
wrangler tail --format pretty
```

## Pre-Deploy Checklist

Before any deployment:
1. All tests pass (`npm test`)
2. Lint passes (`npm run lint`)
3. Build succeeds (`npm run build`)
4. No secrets in committed code
5. Environment variables are set on target platform
6. Feature branch has been reviewed and merged to main

## Post-Deploy Verification

After deploying OpenClaw wrapper:
```bash
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="https://openclaw-production-4e3d.up.railway.app"
# Health check
curl -s $BASE/healthz
# Gateway status
curl -s $BASE/setup/healthz
# Debug info
curl -s -H "Authorization: Basic $AUTH" $BASE/setup/api/debug
```

## Rollback

### Railway
Redeploy a previous commit:
```bash
# Railway auto-deploys from main, so revert the commit
git revert HEAD
git push origin main
```

### Cloudflare
```bash
wrangler rollback
```

## When to Use

- User asks to deploy a project or check deployment status
- User asks to set/update environment variables on Railway
- User wants to check if a deploy succeeded or troubleshoot a failed one
- User asks about the deployment pipeline or CI/CD workflow
- User wants to rollback a deployment

## When NOT to Use

- Code development (just edit files directly)
- Git operations that aren't deploy-related (use `project-ops`)
- Non-deployment infrastructure questions
