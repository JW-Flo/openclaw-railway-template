---
name: roadmap-planner
description: Analyze managed projects and generate prioritized development roadmaps with actionable task queues.
metadata: {"clawdbot":{"emoji":"","requires":{"bins":["gh","git"]}}}
---

# Roadmap Planner

Generate a prioritized development roadmap by scanning all managed projects, identifying high-impact opportunities, and populating the task queue with actionable work items.

## Managed Projects

| Project | Repo | Path |
|---------|------|------|
| Atlas-IT | `JW-Flo/Project-AtlasIT` | `/data/workspace/Project-AtlasIT` |
| AWhittleWandering | `JW-Flo/AWhittleWandering` | `/data/workspace/AWhittleWandering` |
| Market Agents | `JW-Flo/market_agents` | `/data/workspace/market_agents` |
| JW-Site | `JW-Flo/JW-Site` | `/data/workspace/JW-Site` |

## Step 1: Scan Each Project

For every project directory that exists under `/data/workspace/`, gather the following data. If a project directory does not exist, note it as "not cloned" and skip.

### 1a. Git Activity
```bash
cd /data/workspace/{project}
git fetch origin 2>/dev/null
git log --oneline -20
git branch -a --sort=-committerdate | head -10
git diff --stat HEAD~5..HEAD 2>/dev/null || echo "Not enough commits"
```

### 1b. GitHub Issues and PRs
```bash
cd /data/workspace/{project}
gh pr list --limit 10 --json number,title,state,updatedAt,labels
gh issue list --limit 10 --json number,title,state,labels,updatedAt
gh issue list --label bug --limit 5 --json number,title,state
```

### 1c. Project Documentation
- Read `CLAUDE.md` if it exists in the project root (this contains project-specific priorities and architecture notes)
- Read `README.md` for project overview
- Read `package.json` for dependencies, scripts, and project metadata

### 1d. Code Health
```bash
cd /data/workspace/{project}
# Check for lint/build/test scripts and run them
if [ -f package.json ]; then
  npm run lint 2>&1 | tail -20
  npm run build 2>&1 | tail -20
  npm test 2>&1 | tail -20
fi
```

Record pass/fail status and any error summaries for each check.

## Step 2: Evaluate and Prioritize

After scanning all projects, perform the following analysis:

### 2a. Identify Blockers and Critical Issues
- Any failing builds or tests are **priority 1** (critical)
- Open bug issues are **priority 2** (high)
- Stale PRs (open > 7 days with no review) are **priority 2** (high)
- Security-related issues or dependency vulnerabilities are **priority 1** (critical)

### 2b. Assess Highest-Impact Next Steps Per Project
For each project, determine the single most impactful thing that could be done next. Consider:
- What would unblock the most other work?
- What has the highest user-facing impact?
- What is closest to completion (low-hanging fruit)?

### 2c. Cross-Project Synergies
Look for opportunities where work in one project benefits others:
- Shared dependencies that could be updated across all projects
- Common patterns that could be extracted into shared utilities
- Infrastructure improvements (CI/CD, deployment) that benefit the fleet
- Documentation improvements that apply across projects

### 2d. Market Research (market_agents specifically)
For the Market Agents project, perform additional research:
- Check for new prediction markets on Kalshi and Polymarket that could be profitable
- Evaluate current trading strategies: are they performing well or need adjustment?
- Look for new API integrations or data sources that could improve signal quality
- Research trending prediction market categories (politics, sports, crypto, weather, etc.)
- Identify arbitrage opportunities between platforms
- Check if there are new SDK features or API changes to integrate

To research market opportunities:
```bash
# Check Kalshi API for new/trending markets
cd /data/workspace/market_agents
# Review recent trading performance
sqlite3 data/market_agents.db "SELECT date(created_at) as day, COUNT(*) as trades, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins FROM kalshi_fills GROUP BY day ORDER BY day DESC LIMIT 14;" 2>/dev/null || echo "DB not available locally"
# Check for new market categories in the codebase
grep -r "market_ticker\|event_ticker" src/ --include="*.ts" | head -20
```

## Step 3: Generate Outputs

### 3a. Write ROADMAP.md

Create or overwrite `/data/workspace/ROADMAP.md` with the following format:

```markdown
# Development Roadmap

**Generated**: {YYYY-MM-DD HH:MM UTC}
**Next review**: {one week from now}

## Executive Summary

{2-3 sentences summarizing the overall state of the project fleet and the most important priorities}

## Priority Matrix

| Priority | Project | Task | Impact | Effort |
|----------|---------|------|--------|--------|
| 1 (Critical) | ... | ... | ... | ... |
| 2 (High) | ... | ... | ... | ... |
| 3 (Medium) | ... | ... | ... | ... |

## Project-by-Project Analysis

### Project-AtlasIT
- **Current state**: {branch, last commit, build status}
- **Key findings**: {bullet list of notable items}
- **Open issues/PRs**: {count and highlights}
- **Recommended next steps**: {ordered list}

### AWhittleWandering
- **Current state**: {branch, last commit, build status}
- **Key findings**: {bullet list}
- **Open issues/PRs**: {count and highlights}
- **Recommended next steps**: {ordered list}

### market_agents
- **Current state**: {branch, last commit, build status}
- **Key findings**: {bullet list}
- **Trading performance**: {summary if data available}
- **Market opportunities**: {research findings}
- **Recommended next steps**: {ordered list}

### JW-Site
- **Current state**: {branch, last commit, build status}
- **Key findings**: {bullet list}
- **Open issues/PRs**: {count and highlights}
- **Recommended next steps**: {ordered list}

## Cross-Project Opportunities

{Bullet list of synergies and shared improvements}

## Market Research Notes

{Detailed findings from market_agents research — new markets, strategy ideas, API changes}
```

### 3b. Update Project CLAUDE.md Files

For each project that has a `CLAUDE.md` file, update the "Current Priorities" section (or add one if it does not exist). Do NOT overwrite other sections of CLAUDE.md — only update the priorities section.

If CLAUDE.md has a section like `## Current Priorities` or `## TODO` or `## Next Steps`, replace its contents. Otherwise, append a new `## Current Priorities` section at the end.

Format:
```markdown
## Current Priorities

_Last updated by roadmap-planner: {YYYY-MM-DD}_

1. {Highest priority task}
2. {Second priority task}
3. {Third priority task}
```

### 3c. Populate the Task Queue

Read the existing task queue file, add new pending tasks, and write it back:

```bash
# The task queue lives at /data/.openclaw/task-queue.json
```

**Reading and writing the task queue in shell**:
```bash
# Read current queue
QUEUE=$(cat /data/.openclaw/task-queue.json 2>/dev/null || echo '{"tasks":[],"history":[],"config":{}}')

# To add tasks, use the wrapper API (preferred method):
# This requires the SETUP_PASSWORD env var and the wrapper to be running
AUTH=$(echo -n ":${SETUP_PASSWORD}" | base64)
BASE="http://localhost:${PORT:-8080}"

curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
  "$BASE/setup/api/runner/add" \
  -d '{"project":"Project-AtlasIT","title":"Fix failing tests","description":"Tests in src/__tests__/auth.test.ts are failing with timeout errors","priority":1}'
```

**Alternatively, edit the JSON file directly** (if API is not available):
```javascript
// Read
const queue = JSON.parse(fs.readFileSync('/data/.openclaw/task-queue.json', 'utf8'));

// Add a task
queue.tasks.push({
  id: crypto.randomUUID(),
  project: "project-name",
  title: "Task title",
  description: "Detailed description of what to do",
  priority: 2,          // 1=critical, 2=high, 3=medium, 4=low, 5=nice-to-have
  status: "pending",
  createdAt: new Date().toISOString()
});

// Write back
fs.writeFileSync('/data/.openclaw/task-queue.json', JSON.stringify(queue, null, 2));
```

Each task MUST have:
- `project`: The project directory name (e.g., "Project-AtlasIT", "market_agents") or null for cross-project tasks
- `title`: Short, actionable title (imperative mood, e.g., "Fix auth test timeouts")
- `description`: Detailed description with enough context for another agent to execute the task without additional research
- `priority`: Number 1-5 where 1=critical, 2=high, 3=medium, 4=low, 5=nice-to-have

**Priority guidelines**:
- **1 (Critical)**: Broken builds, failing tests, security issues, data loss risks
- **2 (High)**: Bug fixes, stale PRs needing review, blocking issues
- **3 (Medium)**: Feature work, improvements, refactoring
- **4 (Low)**: Documentation, cleanup, minor enhancements
- **5 (Nice-to-have)**: Research tasks, exploratory work, long-term ideas

Do NOT add duplicate tasks. Before adding a task, check if a similar task already exists in the queue (match on project + similar title). Skip duplicates.

## When to Use

- User asks to "plan the roadmap" or "what should we work on next"
- User asks for a "project status report" or "fleet status"
- User asks to "prioritize tasks" or "populate the task queue"
- Scheduled via cron job for periodic roadmap refresh (e.g., weekly)
- User asks "what are the highest impact things to work on"
- User asks to "research market opportunities" for market_agents

## When NOT to Use

- User asks to actually execute a task (just do the task directly)
- User asks about a single specific file or function (just look at it)
- Deployment questions (use `deploy-pipeline` skill)
- Git operations (use `project-ops` skill)

## Tips

- Run this skill weekly (or after major changes) to keep the roadmap fresh
- The task queue integrates with the Runner API — tasks added here can be picked up by automated runners
- Always check existing tasks before adding new ones to avoid duplicates
- For market_agents research, check external sources when possible (Kalshi blog, Polymarket trending, crypto news)
- If a project is not cloned yet, note it in the roadmap and add a task to clone it
