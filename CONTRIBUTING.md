# Contributing

Thank you for contributing to the OpenClaw Railway Template. This guide covers everything needed to go from a fresh clone to a merged PR.

---

## Development Setup

### Prerequisites

- Node.js ≥ 20
- [pnpm](https://pnpm.io) (`npm install -g pnpm`)
- Docker (for local container testing)
- A Railway account (for live deployment testing — optional)

### Clone and install

```bash
git clone https://github.com/JW-Flo/openclaw-railway-template.git
cd openclaw-railway-template
pnpm install
```

### Local run (without Docker)

Requires OpenClaw installed globally (`npm install -g openclaw@latest`) **or** `OPENCLAW_ENTRY` pointing to an existing install.

```bash
cp .env.example .env          # fill in SETUP_PASSWORD at minimum
npm run dev                   # starts wrapper on PORT (default 8080)
```

### Docker build and run

```bash
# Build
docker build -t openclaw-railway-template .

# Run with a local volume
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  openclaw-railway-template

# Open setup wizard
open http://localhost:8080/setup   # password: test
```

### Syntax check

```bash
npm run lint
```

---

## Code Style

- **ESLint**: config in `package.json` (`eslint.config.js` if present). Run `npm run lint` before committing.
- **Prettier**: format JS/HTML/CSS consistently. Run `npx prettier --write .` to auto-format.
- **No TypeScript** in the wrapper (vanilla JS); the SvelteKit dashboard (`dashboard/`) uses TypeScript.
- **No `child_process` imports directly**: all process spawning goes through `src/lib/safe-exec.js` (`safeSpawn()`). ESLint rule enforces this.

---

## Testing

**Current** (before Sprint 1 lands): only a syntax check is available:

```bash
npm run lint     # ESLint / node -c syntax check — the only automated check today
```

**After Sprint 1** (adds Vitest + `pnpm test` scripts): [Vitest](https://vitest.dev) will be the test runner.

```bash
# Run all tests  [Sprint 1]
pnpm test

# Run with coverage report  [Sprint 1]
pnpm test:coverage

# Run a specific file  [Sprint 1]
pnpm test test/lib/credential-store.test.js
```

### Coverage thresholds [Sprint 1]

| Metric | Threshold |
|---|---|
| Statements | 60% |
| Branches | 50% |
| Functions | 60% |

CI will fail if coverage drops below these thresholds once the test suite is in place.

### Test file naming [Sprint 1]

Tests mirror the source tree under `test/`:

```
src/lib/credential-store.js         →  test/lib/credential-store.test.js
src/middleware/csrf.js               →  test/middleware/csrf.test.js
src/alerts/monitors/disk-monitor.js →  test/alerts/monitors/disk-monitor.test.js
```

### Adding tests [Sprint 1]

- Test files use `.test.js` suffix.
- Use `vi.mock()` to mock `fs`, `child_process`, and HTTP calls — never make real network requests in tests.
- Auth and security tests must cover both the "happy path" and failure modes explicitly. See `test/middleware/session-auth.test.js` for the expected pattern (cookie, bearer token, Basic auth fallback, all variants).

---

## Architecture Map

### Current tree (before Sprint 1)

```
openclaw-railway-template/
├── src/
│   ├── server.js               Main Express entry point (monolith — minimize changes here)
│   └── public/
│       ├── setup.html          Setup wizard (static HTML)
│       ├── dashboard.html      DevOps dashboard shell
│       ├── loading.html        Splash/loading page
│       └── tui.html            Web terminal page
├── dashboard/                  SvelteKit dashboard app (compiled to static)
│   └── src/lib/components/shared/  Shared UI components (Card, Modal, DataTable, …)
├── workspace-templates/        Agent personality files + custom skills
│   ├── IDENTITY.md / USER.md / MEMORY.md / TOOLS.md / AGENTS.md / SOUL.md
│   └── skills/                 Custom skill definitions (deploy-pipeline, railway-ops, …)
├── Dockerfile
├── railway.toml
└── entrypoint.sh
```

### Target tree (after Sprint 1 — QA remediation)

Modules below marked **[Sprint 1]** are added by the concurrent Opus PRs. Once merged, `src/server.js` integration points delegate to these modules instead of doing everything inline.

```
openclaw-railway-template/
├── src/
│   ├── server.js               Main Express entry point (monolith — minimize changes here)
│   ├── lib/                                           [Sprint 1]
│   │   ├── safe-exec.js        Command allowlisting — ALL spawns go through here
│   │   ├── credential-store.js AES-256-GCM encrypted credential storage
│   │   └── bootstrap-guard.js  SHA-256 integrity check for bootstrap scripts
│   ├── middleware/                                    [Sprint 1]
│   │   ├── csrf.js             Double-submit CSRF cookie protection
│   │   └── session-auth.js     Session-based auth for /setup (replaces Basic auth)
│   ├── alerts/                                        [Sprint 1]
│   │   ├── index.js            Alert system orchestrator (init + shutdown)
│   │   ├── notifier.js         Send alerts to Telegram/Discord/Slack or stdout
│   │   ├── scheduler.js        Interval-based scheduling (no cron lib dependency)
│   │   ├── state.js            Baseline storage + cooldown tracking
│   │   └── monitors/
│   │       ├── ssh-monitor.js       Alert 1: Failed SSH login detection
│   │       ├── disk-monitor.js      Alert 2: Disk space monitoring
│   │       ├── config-audit.js      Alert 3: Daily SHA-256 config audit
│   │       ├── gateway-monitor.js   Alert 4: Gateway crash detection
│   │       └── auth-monitor.js      Alert 5: Setup wizard brute force
│   └── public/
│       ├── setup.html          Setup wizard (static HTML)
│       ├── login.html          Login page (session auth) [Sprint 1]
│       ├── dashboard.html      DevOps dashboard shell
│       ├── loading.html        Splash/loading page
│       └── tui.html            Web terminal page
├── dashboard/                  SvelteKit dashboard app (compiled to static)
│   └── src/lib/components/shared/  Shared UI components (Card, Modal, DataTable, …)
├── workspace-templates/        Agent personality files + custom skills
│   ├── IDENTITY.md / USER.md / MEMORY.md / TOOLS.md / AGENTS.md / SOUL.md
│   └── skills/                 Custom skill definitions (deploy-pipeline, railway-ops, …)
├── test/                       Test files — mirrors src/ [Sprint 1]
├── Dockerfile
├── railway.toml
└── entrypoint.sh
```

**`src/server.js` is the monolith** — it is intentionally large and handles the full request lifecycle, proxy setup, gateway management, and API endpoints. Prefer extending via the `src/lib/`, `src/middleware/`, and `src/alerts/` modules (once Sprint 1 lands) rather than adding new logic inline.

---

## PR Process

### Branch naming

All branches must use the `claude/` prefix (enforced by repo settings for AI-assisted PRs):

```
claude/<description>-<sessionId>
```

Human contributor branches can use standard naming:

```
fix/<short-description>
feat/<short-description>
docs/<short-description>
test/<short-description>
```

### Commit convention

```
fix(scope): short description
feat(scope): short description
test(scope): short description
docs(scope): short description
refactor(scope): short description
```

Examples:
```
fix(auth): use timingSafeEqual for password comparison
feat(alerts): add disk space monitor
docs(runbook): add gateway boot race playbook
```

### CI requirements

All PRs must pass CI before merge:

1. `npm run lint` — ESLint must be clean
2. `pnpm test` — all tests pass
3. `pnpm test:coverage` — coverage above thresholds
4. No secrets in diff (secret-scan workflow)

### Copilot review

After opening a PR, request a Copilot review:

```bash
curl -s -X POST -H "Authorization: token ${GH_PAT}" -H "Content-Type: application/json" \
  "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls/NUMBER/requested_reviewers" \
  -d '{"reviewers":["Copilot"]}'
```

Wait ~60 seconds, then fetch review comments:

```bash
curl -s -H "Authorization: token ${GH_PAT}" \
  "https://api.github.com/repos/JW-Flo/openclaw-railway-template/pulls/NUMBER/reviews"
```

Address all actionable findings before requesting merge.

### Squash merge

PRs are merged via **squash merge** — all commits are collapsed into one. After your PR is merged, rebase your local branch before starting the next PR:

```bash
git fetch origin main && git rebase origin/main
```

> **Why**: Squash merges cause the feature branch to diverge from `main`. Rebasing after merge keeps history clean and prevents conflicts on the next PR. See CLAUDE.md Gotcha #12.

---

## Security Constraints

These are non-negotiable for every PR:

1. **All process spawns through `safeSpawn()`** — never import `child_process` directly in new code. (`src/lib/safe-exec.js`)
2. **All credentials through `credential-store`** — never write API keys or tokens to `openclaw.json` as plaintext in new code. (`src/lib/credential-store.js`)
3. **All password comparisons via `crypto.timingSafeEqual()`** — prevents timing-based credential enumeration.
4. **CSRF token required for mutations** — all `POST`/`PUT`/`DELETE` endpoints under `/setup/api/*` must use the `requireCsrf` middleware from `src/middleware/csrf.js`.
5. **No secrets in logs** — never log `Authorization` headers, raw tokens, API keys, or cookie values. Log the _presence_ of a credential (`"token: [set]"`) not its value.

PRs that violate these constraints will not be merged regardless of other quality.

---

## Reporting Security Issues

See [SECURITY.md](./SECURITY.md) for the vulnerability disclosure process. Do **not** open public GitHub issues for security findings.
