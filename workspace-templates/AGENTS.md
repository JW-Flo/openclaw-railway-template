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

## Safety Rules
- Never force-push to main/master
- Always run tests before creating a PR
- Never commit secrets or credentials
- Create backups before destructive operations
- Report errors immediately rather than retrying silently
