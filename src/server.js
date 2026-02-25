import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import express from "express";
import httpProxy from "http-proxy";
import pty from "node-pty";
import { WebSocketServer } from "ws";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const STATE_DIR =
  process.env.OPENCLAW_STATE_DIR?.trim() ||
  path.join(os.homedir(), ".openclaw");
const WORKSPACE_DIR =
  process.env.OPENCLAW_WORKSPACE_DIR?.trim() ||
  path.join(STATE_DIR, "workspace");

const SETUP_PASSWORD = process.env.SETUP_PASSWORD?.trim();

function resolveGatewayToken() {
  const envTok = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (envTok) return envTok;

  const tokenPath = path.join(STATE_DIR, "gateway.token");
  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) return existing;
  } catch (err) {
    console.warn(
      `[gateway-token] could not read existing token: ${err.code || err.message}`,
    );
  }

  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, generated, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    console.warn(
      `[gateway-token] could not persist token: ${err.code || err.message}`,
    );
  }
  return generated;
}

const OPENCLAW_GATEWAY_TOKEN = resolveGatewayToken();
process.env.OPENCLAW_GATEWAY_TOKEN = OPENCLAW_GATEWAY_TOKEN;

function readTaskQueue() {
  const queuePath = path.join(STATE_DIR, "task-queue.json");
  try {
    return JSON.parse(fs.readFileSync(queuePath, "utf8"));
  } catch (err) {
    console.warn("[task-queue] read/parse error, using default:", err.message);
    const defaultQueue = {
      tasks: [],
      history: [],
      config: {
        maxConcurrent: 1,
        pauseBetweenTasks: 300,
        dailyTaskLimit: 12,
        paused: false,
        engines: {
          openclaw: { enabled: true, model: "xai/grok-4", timeout: 180 },
        },
      },
    };
    fs.writeFileSync(queuePath, JSON.stringify(defaultQueue, null, 2));
    return defaultQueue;
  }
}

function writeTaskQueue(queue) {
  const queuePath = path.join(STATE_DIR, "task-queue.json");
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
}

let cachedOpenclawVersion = null;
let cachedChannelsHelp = null;

async function getOpenclawInfo() {
  if (!cachedOpenclawVersion) {
    const [version, channelsHelp] = await Promise.all([
      runCmd(OPENCLAW_NODE, clawArgs(["--version"])),
      runCmd(OPENCLAW_NODE, clawArgs(["channels", "add", "--help"])),
    ]);
    cachedOpenclawVersion = version.output.trim();
    cachedChannelsHelp = channelsHelp.output;
  }
  return { version: cachedOpenclawVersion, channelsHelp: cachedChannelsHelp };
}

const INTERNAL_GATEWAY_PORT = Number.parseInt(
  process.env.INTERNAL_GATEWAY_PORT ?? "18789",
  10,
);
const INTERNAL_GATEWAY_HOST = process.env.INTERNAL_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_TARGET = `http://${INTERNAL_GATEWAY_HOST}:${INTERNAL_GATEWAY_PORT}`;

const OPENCLAW_ENTRY =
  process.env.OPENCLAW_ENTRY?.trim() || "/openclaw/dist/entry.js";
const OPENCLAW_NODE = process.env.OPENCLAW_NODE?.trim() || "node";

const ENABLE_WEB_TUI = process.env.ENABLE_WEB_TUI?.toLowerCase() === "true";
const TUI_IDLE_TIMEOUT_MS = Number.parseInt(
  process.env.TUI_IDLE_TIMEOUT_MS ?? "300000",
  10,
);
const TUI_MAX_SESSION_MS = Number.parseInt(
  process.env.TUI_MAX_SESSION_MS ?? "1800000",
  10,
);

function clawArgs(args) {
  return [OPENCLAW_ENTRY, ...args];
}

function configPath() {
  return (
    process.env.OPENCLAW_CONFIG_PATH?.trim() ||
    path.join(STATE_DIR, "openclaw.json")
  );
}

function isConfigured() {
  try {
    return fs.existsSync(configPath());
  } catch {
    return false;
  }
}

let gatewayProc = null;
let gatewayStarting = null;
let shuttingDown = false;
const gatewayLogs = []; // ring buffer for gateway output
const GATEWAY_LOG_MAX = 200;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForGatewayReady(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const perRequestMs = opts.perRequestMs ?? 5_000;
  const start = Date.now();
  const endpoints = ["/openclaw", "/", "/health"];

  while (Date.now() - start < timeoutMs) {
    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), perRequestMs);
        const res = await fetch(`${GATEWAY_TARGET}${endpoint}`, {
          method: "GET",
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok || res.status < 500) {
          try { await res.text(); } catch {}
          console.log(`[gateway] ready at ${endpoint} (status=${res.status})`);
          return true;
        }
        try { await res.text(); } catch {}
      } catch (err) {
        if (err.name === "AbortError") continue;
        if (err.code !== "ECONNREFUSED" && err.cause?.code !== "ECONNREFUSED") {
          const msg = err.code || err.message;
          if (msg !== "fetch failed" && msg !== "UND_ERR_CONNECT_TIMEOUT") {
            console.warn(`[gateway] health check error: ${msg}`);
          }
        }
      }
    }
    await sleep(500);
  }
  console.error(`[gateway] failed to become ready after ${timeoutMs / 1000} seconds`);
  return false;
}

async function startGateway() {
  if (gatewayProc) return;
  if (!isConfigured()) throw new Error("Gateway cannot start: not configured");

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(path.join(STATE_DIR, "credentials"), { recursive: true });

  for (const lockPath of [
    path.join(STATE_DIR, "gateway.lock"),
    "/tmp/openclaw-gateway.lock",
  ]) {
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {}
  }

  // Ensure gateway.mode is set (required since OpenClaw 2026.2.x)
  try {
    const cfgRaw = fs.readFileSync(configPath(), "utf8");
    const cfg = JSON.parse(cfgRaw);
    if (!cfg.gateway?.mode) {
      console.log("[gateway] gateway.mode unset, setting to 'local'...");
      const r = await runCmd(OPENCLAW_NODE, clawArgs(["config", "set", "gateway.mode", "local"]));
      console.log(`[gateway] config set gateway.mode=local exit=${r.code}`);
    }
  } catch (err) {
    console.warn(`[gateway] Could not check/fix gateway.mode: ${err.message}`);
  }

  const args = [
    "gateway",
    "run",
    "--bind",
    "loopback",
    "--port",
    String(INTERNAL_GATEWAY_PORT),
    "--auth",
    "token",
    "--token",
    OPENCLAW_GATEWAY_TOKEN,
    "--allow-unconfigured",
  ];

  gatewayProc = childProcess.spawn(OPENCLAW_NODE, clawArgs(args), {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: STATE_DIR,
      OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
    },
  });

  function pushLog(line) {
    const entry = `[${new Date().toISOString()}] ${line}`;
    gatewayLogs.push(entry);
    if (gatewayLogs.length > GATEWAY_LOG_MAX) gatewayLogs.shift();
    console.log(`[gateway] ${line}`);
  }

  gatewayProc.stdout.on("data", (d) => {
    for (const line of d.toString("utf8").split("\n").filter(Boolean)) pushLog(line);
  });
  gatewayProc.stderr.on("data", (d) => {
    for (const line of d.toString("utf8").split("\n").filter(Boolean)) pushLog(`[stderr] ${line}`);
  });

  const safeArgs = args.map((arg, i) =>
    args[i - 1] === "--token" ? "[REDACTED]" : arg
  );
  console.log(
    `[gateway] starting with command: ${OPENCLAW_NODE} ${clawArgs(safeArgs).join(" ")}`,
  );
  console.log(`[gateway] STATE_DIR: ${STATE_DIR}`);
  console.log(`[gateway] WORKSPACE_DIR: ${WORKSPACE_DIR}`);
  console.log(`[gateway] config path: ${configPath()}`);

  gatewayProc.on("error", (err) => {
    console.error(`[gateway] spawn error: ${String(err)}`);
    gatewayProc = null;
  });

  gatewayProc.on("exit", (code, signal) => {
    console.error(`[gateway] exited code=${code} signal=${signal}`);
    gatewayProc = null;
    if (!shuttingDown && isConfigured()) {
      console.log("[gateway] scheduling auto-restart in 3s...");
      setTimeout(() => {
        if (!shuttingDown && !gatewayProc && !gatewayStarting && isConfigured()) {
          ensureGatewayRunning().catch((err) => {
            console.error(`[gateway] auto-restart failed: ${err.message}`);
          });
        }
      }, 3000);
    }
  });

  // Wait briefly to detect immediate crashes (bad path, missing entry, etc.)
  await sleep(500);
  if (!gatewayProc) {
    throw new Error("Gateway process exited immediately after spawn");
  }
}

async function ensureGatewayRunning() {
  if (!isConfigured()) return { ok: false, reason: "not configured" };
  if (gatewayProc) return { ok: true };
  if (!gatewayStarting) {
    gatewayStarting = (async () => {
      await startGateway();
      const ready = await waitForGatewayReady({ timeoutMs: 60_000 });
      if (!ready) {
        throw new Error("Gateway did not become ready in time");
      }
    })().finally(() => {
      gatewayStarting = null;
    });
  }
  await gatewayStarting;
  return { ok: true };
}

function isGatewayStarting() {
  return gatewayStarting !== null;
}

function isGatewayReady() {
  return gatewayProc !== null && gatewayStarting === null;
}

async function restartGateway() {
  if (gatewayProc) {
    try {
      gatewayProc.kill("SIGTERM");
    } catch (err) {
      console.warn(`[gateway] kill error: ${err.message}`);
    }
    await sleep(750);
    gatewayProc = null;
  }
  return ensureGatewayRunning();
}

const setupRateLimiter = {
  attempts: new Map(),
  windowMs: 60_000,
  maxAttempts: 50,
  cleanupInterval: setInterval(function () {
    const now = Date.now();
    for (const [ip, data] of setupRateLimiter.attempts) {
      if (now - data.windowStart > setupRateLimiter.windowMs) {
        setupRateLimiter.attempts.delete(ip);
      }
    }
  }, 60_000),

  isRateLimited(ip) {
    const now = Date.now();
    const data = this.attempts.get(ip);
    if (!data || now - data.windowStart > this.windowMs) {
      this.attempts.set(ip, { windowStart: now, count: 1 });
      return false;
    }
    data.count++;
    return data.count > this.maxAttempts;
  },
};

function requireSetupAuth(req, res, next) {
  if (!SETUP_PASSWORD) {
    return res
      .status(500)
      .type("text/plain")
      .send(
        "SETUP_PASSWORD is not set. Set it in Railway Variables before using /setup.",
      );
  }

  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  if (setupRateLimiter.isRateLimited(ip)) {
    return res.status(429).type("text/plain").send("Too many requests. Try again later.");
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="OpenClaw Setup"');
    return res.status(401).send("Auth required");
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const password = idx >= 0 ? decoded.slice(idx + 1) : "";
  const passwordHash = crypto.createHash("sha256").update(password).digest();
  const expectedHash = crypto.createHash("sha256").update(SETUP_PASSWORD).digest();
  const isValid = crypto.timingSafeEqual(passwordHash, expectedHash);
  if (!isValid) {
    res.set("WWW-Authenticate", 'Basic realm="OpenClaw Setup"');
    return res.status(401).send("Invalid password");
  }
  return next();
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", async (_req, res) => {
  let gateway = "unconfigured";
  if (isConfigured()) {
    gateway = isGatewayReady() ? "ready" : "starting";
  }
  res.json({ ok: true, gateway });
});

app.get("/setup/healthz", async (_req, res) => {
  const configured = isConfigured();
  const gatewayRunning = isGatewayReady();
  const starting = isGatewayStarting();
  let gatewayReachable = false;

  if (gatewayRunning) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const r = await fetch(`${GATEWAY_TARGET}/`, { signal: controller.signal });
      clearTimeout(timeout);
      gatewayReachable = r !== null;
    } catch {}
  }

  res.json({
    ok: true,
    wrapper: true,
    configured,
    gatewayRunning,
    gatewayStarting: starting,
    gatewayReachable,
  });
});

app.get("/setup", requireSetupAuth, (_req, res) => {
  res.sendFile(path.join(process.cwd(), "src", "public", "setup.html"));
});

app.get("/setup/api/status", requireSetupAuth, async (_req, res) => {
  const { version, channelsHelp } = await getOpenclawInfo();

  const authGroups = [
    {
      value: "openai",
      label: "OpenAI",
      hint: "Codex OAuth + API key",
      options: [
        { value: "codex-cli", label: "OpenAI Codex OAuth (Codex CLI)" },
        { value: "openai-codex", label: "OpenAI Codex (ChatGPT OAuth)" },
        { value: "openai-api-key", label: "OpenAI API key" },
      ],
    },
    {
      value: "anthropic",
      label: "Anthropic",
      hint: "Claude Code CLI + API key",
      options: [
        { value: "claude-cli", label: "Anthropic token (Claude Code CLI)" },
        { value: "token", label: "Anthropic token (paste setup-token)" },
        { value: "apiKey", label: "Anthropic API key" },
      ],
    },
    {
      value: "google",
      label: "Google",
      hint: "Gemini API key + OAuth",
      options: [
        { value: "gemini-api-key", label: "Google Gemini API key" },
        { value: "google-antigravity", label: "Google Antigravity OAuth" },
        { value: "google-gemini-cli", label: "Google Gemini CLI OAuth" },
      ],
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      hint: "API key",
      options: [{ value: "openrouter-api-key", label: "OpenRouter API key" }],
    },
    {
      value: "xai",
      label: "xAI (Grok)",
      hint: "API key",
      options: [{ value: "xai-api-key", label: "xAI API key" }],
    },
    {
      value: "ai-gateway",
      label: "Vercel AI Gateway",
      hint: "API key",
      options: [
        { value: "ai-gateway-api-key", label: "Vercel AI Gateway API key" },
      ],
    },
    {
      value: "moonshot",
      label: "Moonshot AI",
      hint: "Kimi K2 + Kimi Code",
      options: [
        { value: "moonshot-api-key", label: "Moonshot AI API key" },
        { value: "kimi-code-api-key", label: "Kimi Code API key" },
      ],
    },
    {
      value: "zai",
      label: "Z.AI (GLM 4.7)",
      hint: "API key",
      options: [{ value: "zai-api-key", label: "Z.AI (GLM 4.7) API key" }],
    },
    {
      value: "minimax",
      label: "MiniMax",
      hint: "M2.1 (recommended)",
      options: [
        { value: "minimax-api", label: "MiniMax M2.1" },
        { value: "minimax-api-lightning", label: "MiniMax M2.1 Lightning" },
      ],
    },
    {
      value: "qwen",
      label: "Qwen",
      hint: "OAuth",
      options: [{ value: "qwen-portal", label: "Qwen OAuth" }],
    },
    {
      value: "copilot",
      label: "Copilot",
      hint: "GitHub + local proxy",
      options: [
        {
          value: "github-copilot",
          label: "GitHub Copilot (GitHub device login)",
        },
        { value: "copilot-proxy", label: "Copilot Proxy (local)" },
      ],
    },
    {
      value: "synthetic",
      label: "Synthetic",
      hint: "Anthropic-compatible (multi-model)",
      options: [{ value: "synthetic-api-key", label: "Synthetic API key" }],
    },
    {
      value: "opencode-zen",
      label: "OpenCode Zen",
      hint: "API key",
      options: [
        { value: "opencode-zen", label: "OpenCode Zen (multi-model proxy)" },
      ],
    },
  ];

  res.json({
    configured: isConfigured(),
    gatewayTarget: GATEWAY_TARGET,
    openclawVersion: version,
    channelsAddHelp: channelsHelp,
    authGroups,
    tuiEnabled: ENABLE_WEB_TUI,
  });
});

function buildOnboardArgs(payload) {
  const args = [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--json",
    "--no-install-daemon",
    "--skip-health",
    "--workspace",
    WORKSPACE_DIR,
    "--gateway-bind",
    "loopback",
    "--gateway-port",
    String(INTERNAL_GATEWAY_PORT),
    "--gateway-auth",
    "token",
    "--gateway-token",
    OPENCLAW_GATEWAY_TOKEN,
    "--flow",
    payload.flow || "quickstart",
  ];

  if (payload.authChoice) {
    args.push("--auth-choice", payload.authChoice);

    const secret = (payload.authSecret || "").trim();
    const map = {
      "openai-api-key": "--openai-api-key",
      apiKey: "--anthropic-api-key",
      "openrouter-api-key": "--openrouter-api-key",
      "ai-gateway-api-key": "--ai-gateway-api-key",
      "moonshot-api-key": "--moonshot-api-key",
      "kimi-code-api-key": "--kimi-code-api-key",
      "gemini-api-key": "--gemini-api-key",
      "zai-api-key": "--zai-api-key",
      "minimax-api": "--minimax-api-key",
      "minimax-api-lightning": "--minimax-api-key",
      "synthetic-api-key": "--synthetic-api-key",
      "opencode-zen": "--opencode-zen-api-key",
      "xai-api-key": "--xai-api-key",
    };
    const flag = map[payload.authChoice];
    if (flag && secret) {
      args.push(flag, secret);
    }

    if (payload.authChoice === "token" && secret) {
      args.push("--token-provider", "anthropic", "--token", secret);
    }
  }

  return args;
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      ...opts,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
      },
    });

    let out = "";
    proc.stdout?.on("data", (d) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (out += d.toString("utf8")));

    proc.on("error", (err) => {
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on("close", (code) => resolve({ code: code ?? 0, output: out }));
  });
}

const VALID_FLOWS = ["quickstart", "advanced", "manual"];
const VALID_AUTH_CHOICES = [
  "codex-cli",
  "openai-codex",
  "openai-api-key",
  "claude-cli",
  "token",
  "apiKey",
  "gemini-api-key",
  "google-antigravity",
  "google-gemini-cli",
  "openrouter-api-key",
  "ai-gateway-api-key",
  "moonshot-api-key",
  "kimi-code-api-key",
  "zai-api-key",
  "minimax-api",
  "minimax-api-lightning",
  "qwen-portal",
  "github-copilot",
  "copilot-proxy",
  "synthetic-api-key",
  "opencode-zen",
  "xai-api-key",
];

function validatePayload(payload) {
  if (payload.flow && !VALID_FLOWS.includes(payload.flow)) {
    return `Invalid flow: ${payload.flow}. Must be one of: ${VALID_FLOWS.join(", ")}`;
  }
  if (payload.authChoice && !VALID_AUTH_CHOICES.includes(payload.authChoice)) {
    return `Invalid authChoice: ${payload.authChoice}`;
  }
  const stringFields = [
    "telegramToken",
    "discordToken",
    "slackBotToken",
    "slackAppToken",
    "authSecret",
    "model",
  ];
  for (const field of stringFields) {
    if (payload[field] !== undefined && typeof payload[field] !== "string") {
      return `Invalid ${field}: must be a string`;
    }
  }
  return null;
}

app.post("/setup/api/run", requireSetupAuth, async (req, res) => {
  try {
    if (isConfigured()) {
      ensureGatewayRunning().catch((err) => {
        console.error(`[setup] Background gateway start failed: ${err.message}`);
      });
      return res.json({
        ok: true,
        output:
          "Already configured. Gateway is starting in the background.\nUse Reset setup if you want to rerun onboarding.\n",
      });
    }

    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    const payload = req.body || {};
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ ok: false, output: validationError });
    }
    const onboardArgs = buildOnboardArgs(payload);
    const onboard = await runCmd(OPENCLAW_NODE, clawArgs(onboardArgs));

    let extra = "";
    extra += `\n[setup] Onboarding exit=${onboard.code} configured=${isConfigured()}\n`;

    const ok = onboard.code === 0 && isConfigured();

    if (ok) {
      extra += "\n[setup] Configuring gateway settings...\n";

      const allowInsecureResult = await runCmd(
        OPENCLAW_NODE,
        clawArgs([
          "config",
          "set",
          "gateway.controlUi.allowInsecureAuth",
          "true",
        ]),
      );
      extra += `[config] gateway.controlUi.allowInsecureAuth=true exit=${allowInsecureResult.code}\n`;

      const modeResult = await runCmd(
        OPENCLAW_NODE,
        clawArgs(["config", "set", "gateway.mode", "local"]),
      );
      extra += `[config] gateway.mode=local exit=${modeResult.code}\n`;

      const tokenResult = await runCmd(
        OPENCLAW_NODE,
        clawArgs([
          "config",
          "set",
          "gateway.auth.token",
          OPENCLAW_GATEWAY_TOKEN,
        ]),
      );
      extra += `[config] gateway.auth.token exit=${tokenResult.code}\n`;

      const proxiesResult = await runCmd(
        OPENCLAW_NODE,
        clawArgs([
          "config",
          "set",
          "--json",
          "gateway.trustedProxies",
          '["127.0.0.1"]',
        ]),
      );
      extra += `[config] gateway.trustedProxies exit=${proxiesResult.code}\n`;

      if (payload.model?.trim()) {
        extra += `[setup] Setting model to ${payload.model.trim()}...\n`;
        const modelResult = await runCmd(
          OPENCLAW_NODE,
          clawArgs(["models", "set", payload.model.trim()]),
        );
        extra += `[models set] exit=${modelResult.code}\n${modelResult.output || ""}`;
      }

      async function configureChannel(name, cfgObj) {
        const set = await runCmd(
          OPENCLAW_NODE,
          clawArgs([
            "config",
            "set",
            "--json",
            `channels.${name}`,
            JSON.stringify(cfgObj),
          ]),
        );
        const get = await runCmd(
          OPENCLAW_NODE,
          clawArgs(["config", "get", `channels.${name}`]),
        );
        return (
          `\n[${name} config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}` +
          `\n[${name} verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`
        );
      }

      if (payload.telegramToken?.trim()) {
        extra += await configureChannel("telegram", {
          enabled: true,
          dmPolicy: "pairing",
          botToken: payload.telegramToken.trim(),
          groupPolicy: "allowlist",
          streamMode: "partial",
        });
      }

      if (payload.discordToken?.trim()) {
        extra += await configureChannel("discord", {
          enabled: true,
          token: payload.discordToken.trim(),
          groupPolicy: "allowlist",
          dm: { policy: "pairing" },
        });
      }

      if (payload.slackBotToken?.trim() || payload.slackAppToken?.trim()) {
        extra += await configureChannel("slack", {
          enabled: true,
          botToken: payload.slackBotToken?.trim() || undefined,
          appToken: payload.slackAppToken?.trim() || undefined,
        });
      }

      extra += "\n[setup] Starting gateway in background...\n";
      restartGateway()
        .then(() => console.log("[setup] Gateway started successfully."))
        .catch((err) => console.error(`[setup] Gateway background start failed: ${err.message}`));
    }

    return res.status(ok ? 200 : 500).json({
      ok,
      output: `${onboard.output}${extra}`,
    });
  } catch (err) {
    console.error("[/setup/api/run] error:", err);
    return res
      .status(500)
      .json({ ok: false, output: `Internal error: ${String(err)}` });
  }
});

app.get("/setup/api/debug", requireSetupAuth, async (_req, res) => {
  const v = await runCmd(OPENCLAW_NODE, clawArgs(["--version"]));
  const help = await runCmd(
    OPENCLAW_NODE,
    clawArgs(["channels", "add", "--help"]),
  );
  res.json({
    wrapper: {
      node: process.version,
      port: PORT,
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR,
      configPath: configPath(),
      gatewayTokenFromEnv: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN?.trim()),
      gatewayTokenPersisted: fs.existsSync(
        path.join(STATE_DIR, "gateway.token"),
      ),
      railwayCommit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    },
    openclaw: {
      entry: OPENCLAW_ENTRY,
      node: OPENCLAW_NODE,
      version: v.output.trim(),
      channelsAddHelpIncludesTelegram: help.output.includes("telegram"),
    },
    gatewayLogs: gatewayLogs.slice(-50),
  });
});

app.post("/setup/api/pairing/approve", requireSetupAuth, async (req, res) => {
  const { channel, code } = req.body || {};
  if (!channel || !code) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing channel or code" });
  }
  const r = await runCmd(
    OPENCLAW_NODE,
    clawArgs(["pairing", "approve", String(channel), String(code)]),
  );
  return res
    .status(r.code === 0 ? 200 : 500)
    .json({ ok: r.code === 0, output: r.output });
});

app.post("/setup/api/reset", requireSetupAuth, async (_req, res) => {
  try {
    fs.rmSync(configPath(), { force: true });
    res
      .type("text/plain")
      .send("OK - deleted config file. You can rerun setup now.");
  } catch (err) {
    res.status(500).type("text/plain").send(String(err));
  }
});

app.post("/setup/api/doctor", requireSetupAuth, async (_req, res) => {
  const args = ["doctor", "--non-interactive", "--repair"];
  const result = await runCmd(OPENCLAW_NODE, clawArgs(args));
  return res.status(result.code === 0 ? 200 : 500).json({
    ok: result.code === 0,
    output: result.output,
  });
});

app.get("/setup/api/gateway-help", requireSetupAuth, async (_req, res) => {
  const r = await runCmd(OPENCLAW_NODE, clawArgs(["gateway", "run", "--help"]));
  res.json({ code: r.code, output: r.output });
});

app.post("/setup/api/config-get", requireSetupAuth, async (_req, res) => {
  const r = await runCmd(OPENCLAW_NODE, clawArgs(["config", "get", "gateway"]));
  res.json({ code: r.code, output: r.output });
});

app.post("/setup/api/restart-gateway", requireSetupAuth, async (_req, res) => {
  try {
    gatewayLogs.length = 0;
    await restartGateway();
    return res.json({ ok: true, logs: gatewayLogs.slice(-50) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, logs: gatewayLogs.slice(-50) });
  }
});

// Workspace file management — write files into the agent workspace remotely
app.post("/setup/api/workspace/write", requireSetupAuth, express.text({ limit: "1mb", type: "*/*" }), (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ ok: false, error: "Missing ?path= query param" });
  const resolved = path.resolve(WORKSPACE_DIR, filePath);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    return res.status(400).json({ ok: false, error: "Path must be inside workspace" });
  }
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, req.body || "", "utf8");
    return res.json({ ok: true, path: resolved });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/setup/api/workspace/read", requireSetupAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ ok: false, error: "Missing ?path= query param" });
  const resolved = path.resolve(WORKSPACE_DIR, filePath);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    return res.status(400).json({ ok: false, error: "Path must be inside workspace" });
  }
  try {
    const content = fs.readFileSync(resolved, "utf8");
    return res.type("text/plain").send(content);
  } catch (err) {
    return res.status(404).json({ ok: false, error: err.message });
  }
});

app.get("/setup/api/workspace/ls", requireSetupAuth, (req, res) => {
  const dir = req.query.path || ".";
  const resolved = path.resolve(WORKSPACE_DIR, dir);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    return res.status(400).json({ ok: false, error: "Path must be inside workspace" });
  }
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true }).map(e => ({
      name: e.name,
      type: e.isDirectory() ? "dir" : "file",
    }));
    return res.json({ ok: true, path: resolved, entries });
  } catch (err) {
    return res.status(404).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Switch AI provider without full reset
// ---------------------------------------------------------------------------
app.post("/setup/api/switch-provider", requireSetupAuth, async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(400).json({ ok: false, error: "Not configured yet. Run setup first." });
    }
    const { authChoice, authSecret, model } = req.body || {};
    if (!authChoice) {
      return res.status(400).json({ ok: false, error: "Missing authChoice" });
    }
    if (!VALID_AUTH_CHOICES.includes(authChoice)) {
      return res.status(400).json({ ok: false, error: `Invalid authChoice: ${authChoice}` });
    }

    let output = "";

    // Build onboard args just for the auth portion and re-run onboard
    // with --force to overwrite existing config's auth section
    const args = [
      "onboard",
      "--non-interactive",
      "--accept-risk",
      "--json",
      "--no-install-daemon",
      "--skip-health",
      "--workspace", WORKSPACE_DIR,
      "--gateway-bind", "loopback",
      "--gateway-port", String(INTERNAL_GATEWAY_PORT),
      "--gateway-auth", "token",
      "--gateway-token", OPENCLAW_GATEWAY_TOKEN,
      "--flow", "quickstart",
      "--auth-choice", authChoice,
    ];

    // Map auth secrets to CLI flags
    const secretMap = {
      "openai-api-key": "--openai-api-key",
      apiKey: "--anthropic-api-key",
      "openrouter-api-key": "--openrouter-api-key",
      "ai-gateway-api-key": "--ai-gateway-api-key",
      "moonshot-api-key": "--moonshot-api-key",
      "kimi-code-api-key": "--kimi-code-api-key",
      "gemini-api-key": "--gemini-api-key",
      "zai-api-key": "--zai-api-key",
      "minimax-api": "--minimax-api-key",
      "minimax-api-lightning": "--minimax-api-key",
      "synthetic-api-key": "--synthetic-api-key",
      "opencode-zen": "--opencode-zen-api-key",
      "xai-api-key": "--xai-api-key",
    };

    const secret = (authSecret || "").trim();
    const flag = secretMap[authChoice];
    if (flag && secret) {
      args.push(flag, secret);
    }
    if (authChoice === "token" && secret) {
      args.push("--token-provider", "anthropic", "--token", secret);
    }

    // Delete existing config so onboard can re-create it
    const cfgPath = configPath();
    const backupPath = cfgPath + ".bak";
    try {
      fs.copyFileSync(cfgPath, backupPath);
      fs.rmSync(cfgPath);
    } catch {}

    const onboard = await runCmd(OPENCLAW_NODE, clawArgs(args));
    output += onboard.output;

    if (onboard.code !== 0 || !isConfigured()) {
      // Restore backup on failure
      try { fs.copyFileSync(backupPath, cfgPath); } catch {}
      return res.status(500).json({ ok: false, output: `Onboard failed (exit=${onboard.code}):\n${output}` });
    }

    // Re-apply gateway settings
    const configs = [
      ["gateway.controlUi.allowInsecureAuth", "true"],
      ["gateway.mode", "local"],
      ["gateway.auth.token", OPENCLAW_GATEWAY_TOKEN],
    ];
    for (const [key, val] of configs) {
      const r = await runCmd(OPENCLAW_NODE, clawArgs(["config", "set", key, val]));
      output += `\n[config] ${key} exit=${r.code}`;
    }
    const proxiesResult = await runCmd(OPENCLAW_NODE, clawArgs(["config", "set", "--json", "gateway.trustedProxies", '["127.0.0.1"]']));
    output += `\n[config] trustedProxies exit=${proxiesResult.code}`;

    // Set model if provided
    if (model?.trim()) {
      const mr = await runCmd(OPENCLAW_NODE, clawArgs(["models", "set", model.trim()]));
      output += `\n[models set] ${model.trim()} exit=${mr.code}\n${mr.output || ""}`;
    }

    // Clean up backup
    try { fs.rmSync(backupPath, { force: true }); } catch {}

    // Restart gateway with new provider
    output += "\n[switch] Restarting gateway...";
    restartGateway()
      .then(() => console.log("[switch-provider] Gateway restarted successfully."))
      .catch((err) => console.error(`[switch-provider] Gateway restart failed: ${err.message}`));

    return res.json({ ok: true, output });
  } catch (err) {
    console.error("[/setup/api/switch-provider] error:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Model management APIs
// ---------------------------------------------------------------------------
app.get("/setup/api/models/current", requireSetupAuth, async (_req, res) => {
  const r = await runCmd(OPENCLAW_NODE, clawArgs(["models"]));
  // Parse the "Default" line from the output
  const defaultMatch = r.output.match(/Default\s*:\s*(.+)/);
  const model = defaultMatch ? defaultMatch[1].trim() : r.output.trim();
  return res.json({ ok: r.code === 0, model, raw: r.output });
});

app.post("/setup/api/models/set", requireSetupAuth, async (req, res) => {
  const { model } = req.body || {};
  if (!model || typeof model !== "string") {
    return res.status(400).json({ ok: false, error: "Missing model string" });
  }
  const r = await runCmd(OPENCLAW_NODE, clawArgs(["models", "set", model.trim()]));
  return res.json({ ok: r.code === 0, output: r.output });
});

app.get("/setup/api/models/list", requireSetupAuth, async (_req, res) => {
  const r = await runCmd(OPENCLAW_NODE, clawArgs(["models", "list"]));
  return res.json({ ok: r.code === 0, output: r.output });
});

// ---------------------------------------------------------------------------
// Skills management APIs
// ---------------------------------------------------------------------------
app.get("/setup/api/skills/list", requireSetupAuth, async (_req, res) => {
  const r = await runCmd(OPENCLAW_NODE, clawArgs(["skills", "list"]));
  return res.json({ ok: r.code === 0, output: r.output });
});

app.get("/setup/api/skills/eligible", requireSetupAuth, async (_req, res) => {
  const r = await runCmd(OPENCLAW_NODE, clawArgs(["skills", "list", "--eligible"]));
  return res.json({ ok: r.code === 0, output: r.output });
});

app.get("/setup/api/skills/check", requireSetupAuth, async (_req, res) => {
  const r = await runCmd(OPENCLAW_NODE, clawArgs(["skills", "check"]));
  return res.json({ ok: r.code === 0, output: r.output });
});

const SKILL_NAME_RE = /^[a-zA-Z0-9@][a-zA-Z0-9_@/.:-]*$/;

app.post("/setup/api/skills/install", requireSetupAuth, async (req, res) => {
  const { source, force } = req.body || {};
  if (!source || typeof source !== "string") {
    return res.status(400).json({ ok: false, error: "Missing source (e.g. clawhub slug or github:user/repo)" });
  }
  const src = source.trim();
  if (!SKILL_NAME_RE.test(src)) {
    return res.status(400).json({ ok: false, error: "Invalid source format" });
  }
  const clawHubArgs = ["install", src, "--no-input", "--workdir", WORKSPACE_DIR];
  if (force === true) clawHubArgs.push("--force");
  const r = await runCmd("clawhub", clawHubArgs);
  return res.json({ ok: r.code === 0, output: r.output });
});

app.post("/setup/api/skills/uninstall", requireSetupAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ ok: false, error: "Missing skill name" });
  }
  const n = name.trim();
  if (!SKILL_NAME_RE.test(n)) {
    return res.status(400).json({ ok: false, error: "Invalid skill name" });
  }
  const r = await runCmd("clawhub", ["uninstall", n, "--no-input", "--workdir", WORKSPACE_DIR]);
  return res.json({ ok: r.code === 0, output: r.output });
});

app.post("/setup/api/skills/search", requireSetupAuth, async (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== "string") {
    return res.status(400).json({ ok: false, error: "Missing search query" });
  }
  const q = query.trim().substring(0, 200);
  const words = q.split(/\s+/).filter(w => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(w));
  if (words.length === 0) {
    return res.status(400).json({ ok: false, error: "Invalid search query" });
  }
  const r = await runCmd("clawhub", ["search", ...words, "--no-input"]);
  return res.json({ ok: r.code === 0, output: r.output });
});

app.get("/setup/api/skills/info/:name", requireSetupAuth, async (req, res) => {
  const name = req.params.name;
  if (!name || !SKILL_NAME_RE.test(name)) {
    return res.status(400).json({ ok: false, error: "Invalid skill name" });
  }
  const r = await runCmd(OPENCLAW_NODE, clawArgs(["skills", "info", name]));
  return res.json({ ok: r.code === 0, output: r.output });
});

// ---------------------------------------------------------------------------
// Project management APIs
// ---------------------------------------------------------------------------
app.get("/setup/api/projects/status", requireSetupAuth, async (_req, res) => {
  try {
    const entries = fs.readdirSync(WORKSPACE_DIR, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projPath = path.join(WORKSPACE_DIR, entry.name);
      const gitDir = path.join(projPath, ".git");
      if (!fs.existsSync(gitDir)) continue;

      // Get git info
      const branch = await runCmd("git", ["-C", projPath, "rev-parse", "--abbrev-ref", "HEAD"]);
      const lastCommit = await runCmd("git", ["-C", projPath, "log", "-1", "--format=%h %s (%cr)"]);
      const status = await runCmd("git", ["-C", projPath, "status", "--porcelain"]);

      projects.push({
        name: entry.name,
        path: projPath,
        branch: branch.output.trim(),
        lastCommit: lastCommit.output.trim(),
        dirty: (status.output.trim().length > 0),
        dirtyFiles: status.output.trim().split("\n").filter(Boolean).length,
      });
    }
    return res.json({ ok: true, projects });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/setup/api/projects/sync", requireSetupAuth, async (req, res) => {
  const { repos } = req.body || {};
  if (!Array.isArray(repos) || repos.length === 0) {
    return res.status(400).json({ ok: false, error: "Missing repos array (e.g. [\"owner/repo\"])" });
  }

  const results = [];
  for (const repo of repos) {
    if (typeof repo !== "string" || !repo.includes("/")) {
      results.push({ repo, ok: false, error: "Invalid repo format, use owner/repo" });
      continue;
    }
    const repoName = repo.split("/").pop();
    const projPath = path.join(WORKSPACE_DIR, repoName);

    if (fs.existsSync(path.join(projPath, ".git"))) {
      // Pull existing repo
      const pull = await runCmd("git", ["-C", projPath, "pull", "--ff-only"]);
      results.push({
        repo,
        action: "pull",
        ok: pull.code === 0,
        output: pull.output.trim(),
      });
    } else {
      // Clone new repo
      const cloneUrl = `https://github.com/${repo}.git`;
      const clone = await runCmd("git", ["clone", cloneUrl, projPath]);
      results.push({
        repo,
        action: "clone",
        ok: clone.code === 0,
        output: clone.output.trim(),
      });
    }
  }

  return res.json({ ok: results.every((r) => r.ok), results });
});

// Run openclaw CLI commands remotely (auth-protected)
app.post("/setup/api/openclaw-cmd", requireSetupAuth, async (req, res) => {
  const { args } = req.body || {};
  if (!Array.isArray(args) || args.length === 0) {
    return res.status(400).json({ ok: false, error: "Missing args array" });
  }
  // Block dangerous commands
  const blocked = ["onboard", "gateway"];
  if (blocked.includes(args[0])) {
    return res.status(403).json({ ok: false, error: `Command '${args[0]}' is blocked via this API` });
  }
  const r = await runCmd(OPENCLAW_NODE, clawArgs(args));
  return res.json({ ok: r.code === 0, code: r.code, output: r.output });
});

// Run shell commands in workspace (auth-protected, blocklist for safety)
app.post("/setup/api/shell", requireSetupAuth, async (req, res) => {
  const { command, cwd } = req.body || {};
  if (!command || typeof command !== "string") {
    return res.status(400).json({ ok: false, error: "Missing command string" });
  }
  // Safety: block dangerous commands (blocklist approach for flexibility)
  // Use word-boundary regex to avoid false positives (e.g. "dd" matching "add")
  const blocked = [
    /\brm\s+-rf\s+\//, /\bmkfs\b/, /\bdd\b/, /\bshutdown\b/, /\breboot\b/,
    /\bpoweroff\b/, /\bhalt\b/, /\bpasswd\b/, /\buseradd\b/, /\buserdel\b/,
    /\bgroupadd\b/, /\bgroupdel\b/, /\biptables\b/, /\bufw\b/,
    /\bsystemctl\b/, /\bservice\b/,
    /curl\s*\|\s*sh/, /wget\s*\|\s*sh/, /curl\s*\|\s*bash/, /wget\s*\|\s*bash/,
  ];
  const cmdLower = command.trim().toLowerCase();
  for (const pattern of blocked) {
    if (pattern.test(cmdLower)) {
      return res.status(403).json({ ok: false, error: `Command pattern '${pattern}' is blocked for safety` });
    }
  }

  // Resolve working directory (must be within workspace)
  let workDir = WORKSPACE_DIR;
  if (cwd) {
    const resolved = path.resolve(WORKSPACE_DIR, cwd);
    if (resolved.startsWith(WORKSPACE_DIR)) {
      workDir = resolved;
    }
  }

  const r = await runCmd("sh", ["-c", command], { cwd: workDir });
  return res.json({ ok: r.code === 0, code: r.code, output: r.output });
});

// ── Runner / Task Queue API ──────────────────────────────────────────────

// Get the full queue (tasks + config)
app.get("/setup/api/runner/queue", requireSetupAuth, (_req, res) => {
  const queue = readTaskQueue();
  return res.json({ ok: true, tasks: queue.tasks, config: queue.config });
});

// Add a task to the queue
app.post("/setup/api/runner/add", requireSetupAuth, (req, res) => {
  const { project, title, description, priority } = req.body || {};
  if (!title || typeof title !== "string" || title.length > 500) {
    return res.status(400).json({ ok: false, error: "title is required (string, max 500 chars)" });
  }
  const queue = readTaskQueue();
  if (queue.tasks.length >= 200) {
    return res.status(400).json({ ok: false, error: "Task queue full (max 200 tasks)" });
  }
  const validPriority = Number.isInteger(priority) && priority >= 1 && priority <= 10 ? priority : 3;
  const task = {
    id: crypto.randomUUID(),
    project: typeof project === "string" ? project.slice(0, 200) : null,
    title: title.slice(0, 500),
    description: typeof description === "string" ? description.slice(0, 5000) : "",
    priority: validPriority,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  queue.tasks.push(task);
  // Cap history to prevent unbounded growth
  if (queue.history.length > 500) queue.history = queue.history.slice(-500);
  writeTaskQueue(queue);
  return res.json({ ok: true, task });
});

// Remove a task by id
app.post("/setup/api/runner/remove", requireSetupAuth, (req, res) => {
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing required field: id" });
  }
  const queue = readTaskQueue();
  const idx = queue.tasks.findIndex((t) => t.id === id);
  if (idx === -1) {
    return res.status(404).json({ ok: false, error: "Task not found" });
  }
  queue.tasks.splice(idx, 1);
  writeTaskQueue(queue);
  return res.json({ ok: true });
});

// Change task priority
app.post("/setup/api/runner/reorder", requireSetupAuth, (req, res) => {
  const { id, priority } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing required field: id" });
  }
  if (typeof priority !== "number") {
    return res.status(400).json({ ok: false, error: "Missing required field: priority (number)" });
  }
  const queue = readTaskQueue();
  const task = queue.tasks.find((t) => t.id === id);
  if (!task) {
    return res.status(404).json({ ok: false, error: "Task not found" });
  }
  task.priority = Number.isInteger(priority) && priority >= 1 && priority <= 10 ? priority : task.priority;
  writeTaskQueue(queue);
  return res.json({ ok: true, task });
});

// Get runner status
app.get("/setup/api/runner/status", requireSetupAuth, (_req, res) => {
  const queue = readTaskQueue();
  const currentTask = queue.tasks.find((t) => t.status === "running") || null;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const tasksToday = queue.history.filter(
    (h) => h.completedAt && h.completedAt >= todayIso,
  ).length;
  return res.json({
    ok: true,
    paused: queue.config.paused,
    currentTask,
    tasksToday,
    nextRun: "see cron",
  });
});

// Get task history (last 50 entries)
app.get("/setup/api/runner/history", requireSetupAuth, (_req, res) => {
  const queue = readTaskQueue();
  const history = (queue.history || []).slice(-50);
  return res.json({ ok: true, history });
});

// Update runner config (whitelist-based merge to prevent prototype pollution)
app.post("/setup/api/runner/config", requireSetupAuth, (req, res) => {
  const updates = req.body || {};
  if (typeof updates !== "object" || Array.isArray(updates)) {
    return res.status(400).json({ ok: false, error: "Body must be a JSON object" });
  }
  const queue = readTaskQueue();
  const allowed = ["maxConcurrent", "pauseBetweenTasks", "dailyTaskLimit", "paused"];
  for (const key of allowed) {
    if (key in updates) queue.config[key] = updates[key];
  }
  if (updates.engines && typeof updates.engines === "object" && !Array.isArray(updates.engines)) {
    if (!queue.config.engines) queue.config.engines = {};
    const allowedEngineKeys = ["enabled", "model", "timeout", "note"];
    for (const [k, v] of Object.entries(updates.engines)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (typeof v === "object" && v !== null && !Array.isArray(v)
          && typeof queue.config.engines[k] === "object" && queue.config.engines[k] !== null) {
        for (const ek of allowedEngineKeys) {
          if (ek in v) queue.config.engines[k][ek] = v[ek];
        }
      } else {
        queue.config.engines[k] = v;
      }
    }
  }
  writeTaskQueue(queue);
  return res.json({ ok: true, config: queue.config });
});

// Toggle pause
app.post("/setup/api/runner/pause", requireSetupAuth, (req, res) => {
  const { paused } = req.body || {};
  if (typeof paused !== "boolean") {
    return res.status(400).json({ ok: false, error: "Missing required field: paused (boolean)" });
  }
  const queue = readTaskQueue();
  queue.config.paused = paused;
  writeTaskQueue(queue);
  return res.json({ ok: true, paused: queue.config.paused });
});

// Serve SvelteKit dashboard build output (static files)
const dashboardBuildDir = path.join(process.cwd(), "dashboard", "build");
app.use(
  "/dashboard",
  requireSetupAuth,
  express.static(dashboardBuildDir, { maxAge: "1h", index: false }),
);
app.get("/dashboard", requireSetupAuth, (_req, res) => {
  res.sendFile(path.join(dashboardBuildDir, "index.html"));
});
app.get("/dashboard/*", requireSetupAuth, (_req, res) => {
  res.sendFile(path.join(dashboardBuildDir, "index.html"));
});

app.get("/tui", requireSetupAuth, (_req, res) => {
  if (!ENABLE_WEB_TUI) {
    return res
      .status(403)
      .type("text/plain")
      .send("Web TUI is disabled. Set ENABLE_WEB_TUI=true to enable it.");
  }
  if (!isConfigured()) {
    return res.redirect("/setup");
  }
  res.sendFile(path.join(process.cwd(), "src", "public", "tui.html"));
});

let activeTuiSession = null;

function verifyTuiAuth(req) {
  if (!SETUP_PASSWORD) return false;
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const password = idx >= 0 ? decoded.slice(idx + 1) : "";
  const passwordHash = crypto.createHash("sha256").update(password).digest();
  const expectedHash = crypto.createHash("sha256").update(SETUP_PASSWORD).digest();
  return crypto.timingSafeEqual(passwordHash, expectedHash);
}

function createTuiWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, req) => {
    const clientIp = req.socket?.remoteAddress || "unknown";
    console.log(`[tui] session started from ${clientIp}`);

    let ptyProcess = null;
    let idleTimer = null;
    let maxSessionTimer = null;

    activeTuiSession = {
      ws,
      pty: null,
      startedAt: Date.now(),
      lastActivity: Date.now(),
    };

    function resetIdleTimer() {
      if (activeTuiSession) {
        activeTuiSession.lastActivity = Date.now();
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        console.log("[tui] session idle timeout");
        ws.close(4002, "Idle timeout");
      }, TUI_IDLE_TIMEOUT_MS);
    }

    function spawnPty(cols, rows) {
      if (ptyProcess) return;

      console.log(`[tui] spawning PTY with ${cols}x${rows}`);
      ptyProcess = pty.spawn(OPENCLAW_NODE, clawArgs(["tui"]), {
        name: "xterm-256color",
        cols,
        rows,
        cwd: WORKSPACE_DIR,
        env: {
          ...process.env,
          OPENCLAW_STATE_DIR: STATE_DIR,
          OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
          TERM: "xterm-256color",
        },
      });

      if (activeTuiSession) {
        activeTuiSession.pty = ptyProcess;
      }

      idleTimer = setTimeout(() => {
        console.log("[tui] session idle timeout");
        ws.close(4002, "Idle timeout");
      }, TUI_IDLE_TIMEOUT_MS);

      maxSessionTimer = setTimeout(() => {
        console.log("[tui] max session duration reached");
        ws.close(4002, "Max session duration");
      }, TUI_MAX_SESSION_MS);

      ptyProcess.onData((data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`[tui] PTY exited code=${exitCode} signal=${signal}`);
        if (ws.readyState === ws.OPEN) {
          ws.close(1000, "Process exited");
        }
      });
    }

    ws.on("message", (message) => {
      resetIdleTimer();
      try {
        const msg = JSON.parse(message.toString());
        if (msg.type === "resize" && msg.cols && msg.rows) {
          const cols = Math.min(Math.max(msg.cols, 10), 500);
          const rows = Math.min(Math.max(msg.rows, 5), 200);
          if (!ptyProcess) {
            spawnPty(cols, rows);
          } else {
            ptyProcess.resize(cols, rows);
          }
        } else if (msg.type === "input" && msg.data && ptyProcess) {
          ptyProcess.write(msg.data);
        }
      } catch (err) {
        console.warn(`[tui] invalid message: ${err.message}`);
      }
    });

    ws.on("close", () => {
      console.log("[tui] session closed");
      clearTimeout(idleTimer);
      clearTimeout(maxSessionTimer);
      if (ptyProcess) {
        try {
          ptyProcess.kill();
        } catch {}
      }
      activeTuiSession = null;
    });

    ws.on("error", (err) => {
      console.error(`[tui] WebSocket error: ${err.message}`);
    });
  });

  return wss;
}

const proxy = httpProxy.createProxyServer({
  target: GATEWAY_TARGET,
  ws: true,
  xfwd: true,
  proxyTimeout: 0, // disable timeout for long-lived WebSocket connections
  timeout: 0,      // disable socket timeout (keepalive handles liveness)
});

proxy.on("error", (err, _req, res) => {
  console.error("[proxy]", err.code || err.message);
  // res is an HTTP ServerResponse for HTTP requests, but a raw Socket for WebSocket upgrades.
  // Only send HTML error for HTTP responses; for sockets, just destroy cleanly.
  if (res && typeof res.headersSent !== "undefined" && !res.headersSent) {
    res.writeHead(503, { "Content-Type": "text/html" });
    try {
      const html = fs.readFileSync(
        path.join(process.cwd(), "src", "public", "loading.html"),
        "utf8",
      );
      res.end(html);
    } catch {
      res.end("Gateway unavailable. Retrying...");
    }
  } else if (res && typeof res.destroy === "function") {
    // WebSocket socket — destroy cleanly instead of sending HTML
    res.destroy();
  }
});

proxy.on("proxyReq", (proxyReq, req, res) => {
  proxyReq.setHeader("Authorization", `Bearer ${OPENCLAW_GATEWAY_TOKEN}`);
});

proxy.on("proxyReqWs", (proxyReq, req, socket, options, head) => {
  proxyReq.setHeader("Authorization", `Bearer ${OPENCLAW_GATEWAY_TOKEN}`);
  // Also ensure token is in path for gateways that only check query params
  if (proxyReq.path && !proxyReq.path.includes("token=")) {
    const sep = proxyReq.path.includes("?") ? "&" : "?";
    proxyReq.path += `${sep}token=${OPENCLAW_GATEWAY_TOKEN}`;
  }
});

app.use(async (req, res) => {
  if (!isConfigured() && !req.path.startsWith("/setup")) {
    return res.redirect("/setup");
  }

  if (isConfigured()) {
    if (!isGatewayReady()) {
      try {
        await ensureGatewayRunning();
      } catch {
        return res
          .status(503)
          .sendFile(path.join(process.cwd(), "src", "public", "loading.html"));
      }

      if (!isGatewayReady()) {
        return res
          .status(503)
          .sendFile(path.join(process.cwd(), "src", "public", "loading.html"));
      }
    }
  }

  // Bootstrap the Control UI by injecting the gateway token into localStorage.
  // The Control UI reads auth from localStorage["openclaw.control.settings.v1"].token
  // but does NOT auto-populate it from the URL ?token= parameter. We serve a tiny
  // bootstrap page that writes the token, then redirects to the actual proxied UI.
  if (req.path === "/openclaw" && !req.query._boot) {
    const tokenJson = JSON.stringify(OPENCLAW_GATEWAY_TOKEN);
    const bootstrapHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Connecting…</title>
<style>body{display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0;font-family:system-ui,sans-serif}
.loader{text-align:center}.spinner{width:40px;height:40px;border:3px solid #333;border-top-color:#7c3aed;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}</style></head>
<body><div class="loader"><div class="spinner"></div><p>Connecting to OpenClaw…</p></div>
<script>
try {
  var KEY = "openclaw.control.settings.v1";
  var s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) {}
  s.token = ${tokenJson};
  localStorage.setItem(KEY, JSON.stringify(s));
} catch (e) { console.warn("token bootstrap failed:", e); }
window.location.replace("/openclaw?_boot=1");
</script>
<noscript><a href="/openclaw?_boot=1">Continue to OpenClaw</a></noscript>
</body></html>`;
    return res.type("html").send(bootstrapHtml);
  }

  // Strip the _boot query param before proxying so the gateway gets a clean URL.
  if (req.query._boot) {
    const u = new URL(req.url, `http://${req.headers.host}`);
    u.searchParams.delete("_boot");
    req.url = u.pathname + (u.search === "?" ? "" : u.search);
  }

  return proxy.web(req, res, { target: GATEWAY_TARGET });
});

const server = app.listen(PORT, () => {
  console.log(`[wrapper] listening on port ${PORT}`);
  console.log(`[wrapper] setup wizard: http://localhost:${PORT}/setup`);
  console.log(`[wrapper] web TUI: ${ENABLE_WEB_TUI ? "enabled" : "disabled"}`);
  console.log(`[wrapper] configured: ${isConfigured()}`);

  if (isConfigured()) {
    (async () => {
      try {
        console.log("[wrapper] running openclaw doctor --non-interactive --repair...");
        const dr = await runCmd(OPENCLAW_NODE, clawArgs(["doctor", "--non-interactive", "--repair"]));
        console.log(`[wrapper] doctor --fix exit=${dr.code}`);
        if (dr.output) console.log(dr.output);
      } catch (err) {
        console.warn(`[wrapper] doctor --fix failed: ${err.message}`);
      }
      await ensureGatewayRunning();
    })().catch((err) => {
      console.error(`[wrapper] failed to start gateway at boot: ${err.message}`);
    });
  }
});

const tuiWss = createTuiWebSocketServer(server);

server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/tui/ws") {
    if (!ENABLE_WEB_TUI) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!verifyTuiAuth(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"OpenClaw TUI\"\r\n\r\n");
      socket.destroy();
      return;
    }

    if (activeTuiSession) {
      socket.write("HTTP/1.1 409 Conflict\r\n\r\n");
      socket.destroy();
      return;
    }

    tuiWss.handleUpgrade(req, socket, head, (ws) => {
      tuiWss.emit("connection", ws, req);
    });
    return;
  }

  if (!isConfigured()) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
    return;
  }
  try {
    await ensureGatewayRunning();
  } catch (err) {
    console.warn(`[websocket] gateway not ready: ${err.message}`);
    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
    return;
  }

  // Ensure token is in the URL query so the gateway Control UI accepts the connection.
  // Browsers cannot set custom headers on WebSocket handshakes, so the gateway may
  // only check the query parameter for pairing bypass.
  const wsUrl = new URL(req.url, `http://${req.headers.host}`);
  if (!wsUrl.searchParams.has("token")) {
    wsUrl.searchParams.set("token", OPENCLAW_GATEWAY_TOKEN);
    req.url = wsUrl.pathname + wsUrl.search;
  }

  proxy.ws(req, socket, head, { target: GATEWAY_TARGET });
});

// Keep proxied WebSocket connections alive through Railway's load balancer.
// Railway (and most cloud LBs) kill idle TCP connections after ~60s.
// We send TCP-level keepalive on the upstream socket so the LB sees activity.
proxy.on("open", (proxySocket) => {
  proxySocket.setKeepAlive(true, 30_000); // TCP keepalive every 30s
});

async function gracefulShutdown(signal) {
  console.log(`[wrapper] received ${signal}, shutting down`);
  shuttingDown = true;

  if (setupRateLimiter.cleanupInterval) {
    clearInterval(setupRateLimiter.cleanupInterval);
  }

  if (activeTuiSession) {
    try {
      activeTuiSession.ws.close(1001, "Server shutting down");
      activeTuiSession.pty.kill();
    } catch {}
    activeTuiSession = null;
  }

  server.close();

  if (gatewayProc) {
    try {
      gatewayProc.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => gatewayProc.on("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      if (gatewayProc && !gatewayProc.killed) {
        gatewayProc.kill("SIGKILL");
      }
    } catch (err) {
      console.warn(`[wrapper] error killing gateway: ${err.message}`);
    }
  }

  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
