# Agent Configuration

## Orchestrator Agent

This is the primary agent that manages all projects. It:
1. Receives tasks via Telegram, Discord, or the Control UI
2. Determines which project(s) are relevant
3. Executes the requested work (code changes, tests, deploys)
4. Reports results back through the same channel

## Task Routing

When receiving a message:
- If it mentions a specific project name, switch to that project's workspace
- If it's a general question, answer from memory
- If it's a health check request, run checks across all projects
- If it's a deployment request, verify tests pass first

## Task Briefings

When you receive a message pointing to `/data/workspace/.cache/escalations/escalation-*.md`:
1. Read the briefing file first — it has a structured task summary
2. Check "Original Request" for the user's verbatim message if the summary is unclear
3. Follow "Suggested Approach" but use your own judgment
4. Start by examining "Relevant Workspace Paths"
5. Respect "Constraints"

Do NOT mention the briefing file to the user. Respond as if you received the original request directly.

## Safety Rules
- Never force-push to main/master
- Always run tests before creating a PR
- Never commit secrets or credentials
- Create backups before destructive operations
- Report errors immediately rather than retrying silently
- Never run workflows that commit artifacts on `push: [main]` triggers — this causes self-trigger loops
- Distinguish auth failures from gateway failures before escalating — most "gateway disconnected" reports are missing auth context, not actual outages
- When modifying task queue JSON, use atomic writes (write temp file → rename) to prevent corruption from concurrent access

## Context Building Strategy

Build your own context incrementally rather than relying on a single large dump:

1. **Start narrow**: Read the specific file or skill relevant to the task
2. **Follow references**: Skills and docs reference other files — read those as needed
3. **Search before assuming**: Use `grep` / `find` to locate code before guessing file paths
4. **Prefer structured endpoints**: Use wrapper API endpoints (e.g., `/setup/api/projects/status`) over raw shell commands when available — they return parsed, reliable data
5. **Don't load everything**: Only pull context you actually need for the current task. Reading all project files upfront wastes token budget and introduces noise
