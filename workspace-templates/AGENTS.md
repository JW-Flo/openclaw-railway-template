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
