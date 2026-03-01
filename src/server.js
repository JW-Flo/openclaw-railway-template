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
          openclaw: { enabled: true, model: "openai/gpt-4o-mini", timeout: 180 },
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

// ── Model Pool & Auto-Scheduler ─────────────────────────────────────────

const MODEL_POOL_PATH = path.join(STATE_DIR, "model-pool.json");

function defaultModelPool() {
  return {
    models: [
      // ── Free tier (tried first via free-first strategy) ────────────
      {
        id: "google/gemini-2.5-flash:free",
        provider: "google",
        tier: "free",
        costPer1kTokens: 0,
        dailyLimit: 80,
        usedToday: 0,
        lastResetDate: "",
        enabled: true,
        priority: 1,
        minTaskPriority: 1,
        maxTaskPriority: 10,
        capabilities: ["code", "analysis", "planning", "triage"],
      },
      {
        id: "openrouter/qwen/qwen3-coder:free",
        provider: "openrouter",
        tier: "free",
        costPer1kTokens: 0,
        dailyLimit: 60,
        usedToday: 0,
        lastResetDate: "",
        enabled: true,
        priority: 2,
        minTaskPriority: 1,
        maxTaskPriority: 10,
        capabilities: ["code", "triage"],
      },
      // ── Economy tier (cheapest paid, for when free can't handle it) ─
      {
        id: "openai/gpt-4.1-nano",
        provider: "openai",
        tier: "economy",
        costPer1kTokens: 0.00025,
        dailyLimit: 100,
        usedToday: 0,
        lastResetDate: "",
        enabled: true,
        priority: 3,
        minTaskPriority: 1,
        maxTaskPriority: 10,
        capabilities: ["code", "analysis"],
      },
      // ── Standard tier ──────────────────────────────────────────────
      {
        id: "openai/gpt-4o-mini",
        provider: "openai",
        tier: "standard",
        costPer1kTokens: 0.000375,
        dailyLimit: 50,
        usedToday: 0,
        lastResetDate: "",
        enabled: true,
        priority: 4,
        minTaskPriority: 1,
        maxTaskPriority: 10,
        capabilities: ["code", "analysis", "planning"],
      },
      {
        id: "openai/gpt-4.1-mini",
        provider: "openai",
        tier: "standard",
        costPer1kTokens: 0.001,
        dailyLimit: 40,
        usedToday: 0,
        lastResetDate: "",
        enabled: true,
        priority: 5,
        minTaskPriority: 1,
        maxTaskPriority: 10,
        capabilities: ["code", "analysis", "planning"],
      },
      // ── Premium tier (only for complex reasoning / critical tasks) ─
      {
        id: "openai/o4-mini",
        provider: "openai",
        tier: "premium",
        costPer1kTokens: 0.00275,
        dailyLimit: 20,
        usedToday: 0,
        lastResetDate: "",
        enabled: true,
        priority: 6,
        minTaskPriority: 1,
        maxTaskPriority: 3,
        capabilities: ["code", "analysis", "planning", "reasoning"],
      },
      {
        id: "openai/gpt-4.1",
        provider: "openai",
        tier: "premium",
        costPer1kTokens: 0.005,
        dailyLimit: 15,
        usedToday: 0,
        lastResetDate: "",
        enabled: true,
        priority: 7,
        minTaskPriority: 1,
        maxTaskPriority: 3,
        capabilities: ["code", "analysis", "planning"],
      },
      // ── Fallback ───────────────────────────────────────────────────
      {
        id: "openrouter/auto",
        provider: "openrouter",
        tier: "fallback",
        costPer1kTokens: 0.005,
        dailyLimit: 25,
        usedToday: 0,
        lastResetDate: "",
        enabled: true,
        priority: 8,
        minTaskPriority: 1,
        maxTaskPriority: 10,
        capabilities: ["code", "analysis", "planning"],
      },
    ],
    scheduler: {
      enabled: false,
      intervalSeconds: 600,
      strategy: "free-first",
      maxConcurrent: 1,
      pauseStart: "00:00",
      pauseEnd: "06:00",
      timezone: "America/Chicago",
    },
  };
}

function readModelPool() {
  try {
    const data = JSON.parse(fs.readFileSync(MODEL_POOL_PATH, "utf8"));
    if (!data.models || !data.scheduler) throw new Error("invalid");
    return data;
  } catch {
    const pool = defaultModelPool();
    fs.writeFileSync(MODEL_POOL_PATH, JSON.stringify(pool, null, 2));
    return pool;
  }
}

function writeModelPool(pool) {
  fs.writeFileSync(MODEL_POOL_PATH, JSON.stringify(pool, null, 2));
}

function resetDailyCountsIfNeeded(pool) {
  const today = new Date().toISOString().slice(0, 10);
  for (const m of pool.models) {
    if (m.lastResetDate !== today) {
      m.usedToday = 0;
      m.lastResetDate = today;
    }
  }
}

function selectModelForTask(pool, taskPriority) {
  resetDailyCountsIfNeeded(pool);
  const strategy = pool.scheduler.strategy || "free-first";
  const eligible = pool.models.filter(
    (m) =>
      m.enabled &&
      m.usedToday < m.dailyLimit &&
      taskPriority >= m.minTaskPriority &&
      taskPriority <= m.maxTaskPriority
  );
  if (eligible.length === 0) return null;

  if (strategy === "free-first") {
    // Always prefer free models. Only use paid if no free models are available
    // or if task is explicitly high-priority (1-2) indicating triage escalation.
    const free = eligible.filter((m) => m.tier === "free");
    if (free.length > 0 && taskPriority >= 3) {
      free.sort((a, b) => a.priority - b.priority);
      return free[0];
    }
    // For escalated tasks (priority 1-2) or if no free models available,
    // pick cheapest paid model first, then fall through to free
    eligible.sort((a, b) => {
      // Escalated tasks skip free tier
      if (taskPriority <= 2) {
        const aFree = a.tier === "free" ? 1 : 0;
        const bFree = b.tier === "free" ? 1 : 0;
        if (aFree !== bFree) return aFree - bFree; // paid first
      }
      return a.costPer1kTokens - b.costPer1kTokens || a.priority - b.priority;
    });
  } else if (strategy === "cost-optimized") {
    if (taskPriority <= 3) {
      eligible.sort((a, b) => a.priority - b.priority);
    } else if (taskPriority >= 7) {
      eligible.sort((a, b) => a.costPer1kTokens - b.costPer1kTokens || b.priority - a.priority);
    } else {
      eligible.sort((a, b) => {
        const scoreA = a.costPer1kTokens * 0.5 + a.priority * 0.5;
        const scoreB = b.costPer1kTokens * 0.5 + b.priority * 0.5;
        return scoreA - scoreB;
      });
    }
  } else if (strategy === "round-robin") {
    eligible.sort((a, b) => a.usedToday - b.usedToday);
  } else if (strategy === "quality-first") {
    eligible.sort((a, b) => a.priority - b.priority);
  } else {
    eligible.sort((a, b) => a.costPer1kTokens - b.costPer1kTokens);
  }
  return eligible[0];
}

// ── Prompt Triage (free model decides if paid model is needed) ───────────

const TRIAGE_SYSTEM_PROMPT = `You are a prompt complexity and model-type classifier for an AI coding assistant. Evaluate the user prompt and decide:
1. Which cost tier should handle it
2. Which model TYPE is best suited

Respond with ONLY a JSON object, no markdown.

Tiers (cost escalation):
- "free": Simple questions, greetings, basic lookups, short summaries, trivial code, status checks, small edits
- "economy": Moderate tasks, single-file edits, straightforward explanations, simple debugging
- "standard": Multi-step tasks, multi-file code changes, detailed analysis, API integrations
- "premium": Complex multi-step reasoning, architecture design, large refactoring, math proofs, advanced debugging

Model types (capability matching):
- "general": Conversational, Q&A, summaries, explanations (→ gpt-4o-mini, gemini-flash)
- "code": Code generation, editing, debugging, reviews (→ gpt-4.1-nano, gpt-4.1-mini, codex)
- "reasoning": Logic, math, planning, architecture, multi-step problem solving (→ o4-mini)
- "agentic": Multi-turn tool use, file operations, git workflows, long chains (→ gpt-4.1, benefits from WebSocket mode)

JSON format: {"tier":"free","modelType":"general","reason":"brief reason"}`;

async function triagePrompt(userMessage) {
  const orToken = process.env.OPENROUTER_API_TOKEN?.trim();
  if (!orToken) return { tier: "free", modelType: "general", reason: "no triage key available" };

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${orToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash:free",
        messages: [
          { role: "system", content: TRIAGE_SYSTEM_PROMPT },
          { role: "user", content: userMessage.slice(0, 2000) },
        ],
        max_tokens: 120,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      console.warn(`[triage] API error ${resp.status}, defaulting to free`);
      return { tier: "free", modelType: "general", reason: "triage api error" };
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    const parsed = JSON.parse(content.replace(/^```json\s*|```$/g, "").trim());
    const validTiers = ["free", "economy", "standard", "premium"];
    const validTypes = ["general", "code", "reasoning", "agentic"];
    if (validTiers.includes(parsed.tier)) {
      parsed.modelType = validTypes.includes(parsed.modelType) ? parsed.modelType : "general";
      console.log(`[triage] "${userMessage.slice(0, 80)}..." → ${parsed.tier}/${parsed.modelType}: ${parsed.reason}`);
      return parsed;
    }
    return { tier: "free", modelType: "general", reason: "invalid triage response" };
  } catch (err) {
    console.warn(`[triage] error: ${err.message}, defaulting to free`);
    return { tier: "free", modelType: "general", reason: `triage error: ${err.message}` };
  }
}

function selectModelByTier(pool, tier, modelType) {
  resetDailyCountsIfNeeded(pool);

  // Model-type preference mapping: which model IDs are best for each type
  const typePreferences = {
    code: ["openai/gpt-4.1-nano", "openai/gpt-4.1-mini", "openai/gpt-4.1", "openrouter/qwen/qwen3-coder:free"],
    reasoning: ["openai/o4-mini", "openai/gpt-4.1", "openai/gpt-4o-mini"],
    agentic: ["openai/gpt-4.1", "openai/gpt-4.1-mini", "openai/o4-mini"],
    general: [], // no preference, use tier-based selection
  };

  const tierOrder = {
    free: ["free"],
    economy: ["economy", "free"],
    standard: ["standard", "economy"],
    premium: ["premium", "standard"],
  };
  const tiers = tierOrder[tier] || ["free"];
  const preferred = typePreferences[modelType || "general"] || [];

  // First pass: find a model matching both tier AND model-type preference
  for (const t of tiers) {
    const inTier = pool.models.filter(
      (m) => m.enabled && m.tier === t && m.usedToday < m.dailyLimit
    );
    if (preferred.length > 0) {
      const match = inTier.find((m) => preferred.includes(m.id));
      if (match) return match;
    }
    // No type-specific match in this tier, pick cheapest in tier
    if (inTier.length > 0) {
      inTier.sort((a, b) => a.costPer1kTokens - b.costPer1kTokens || a.priority - b.priority);
      return inTier[0];
    }
  }

  // Final fallback: any available model, cheapest first
  const any = pool.models.filter((m) => m.enabled && m.usedToday < m.dailyLimit);
  any.sort((a, b) => a.costPer1kTokens - b.costPer1kTokens);
  return any[0] || null;
}

// ── Prompt Compression on Escalation ────────────────────────────────────

const ESCALATION_CACHE_DIR = path.join(WORKSPACE_DIR, ".cache", "escalations");

const COMPRESSION_SYSTEM_PROMPT = `You are a task briefing compiler for an AI coding assistant. Produce a concise, structured task brief that another AI model can execute efficiently.

Output ONLY a markdown document with this exact structure:

# Task Brief

## Objective
[1-2 sentences: what the user wants accomplished]

## Task Type
[One of: code-change, debugging, analysis, deployment, multi-project, infrastructure, documentation, planning]

## Context
[Key facts the executing model needs. Include project names, technologies, APIs mentioned. 2-5 bullet points max.]

## Relevant Workspace Paths
[List /data/workspace/<project> paths to examine. If unsure, say "Determine from context".]

## Constraints
[Requirements, deadlines, quality standards, or "None specified".]

## Suggested Approach
[2-4 numbered steps the executing model should follow]

## Original Request
[The user's complete original message, preserved verbatim]

Rules:
- Be precise and actionable
- Do NOT fabricate file paths — only reference paths/projects explicitly mentioned
- Keep the brief under 800 tokens (excluding Original Request)
- The Original Request section MUST contain the COMPLETE unmodified user message
- Known workspace projects: Project-AtlasIT, AWhittleWandering, market_agents, JW-Site`;

async function compressPromptForEscalation(userMessage, triage, sessionId) {
  const orToken = process.env.OPENROUTER_API_TOKEN?.trim();
  if (!orToken) return null;

  const startTime = Date.now();
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${orToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash:free",
        messages: [
          { role: "system", content: COMPRESSION_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Triage: tier=${triage.tier}, type=${triage.modelType}, reason=${triage.reason}\n\n--- USER MESSAGE ---\n${userMessage.slice(0, 10000)}`,
          },
        ],
        max_tokens: 1500,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      console.warn(`[compression] API error ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const briefing = data.choices?.[0]?.message?.content?.trim();
    if (!briefing || briefing.length < 50) {
      console.warn("[compression] briefing too short, skipping");
      return null;
    }

    fs.mkdirSync(ESCALATION_CACHE_DIR, { recursive: true });
    // Sanitize sessionId to prevent path traversal
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    const briefingPath = path.join(ESCALATION_CACHE_DIR, `escalation-${safeId}.md`);
    fs.writeFileSync(briefingPath, briefing, "utf8");

    const elapsed = Date.now() - startTime;
    const origEst = Math.ceil(userMessage.length / 4);
    const briefEst = Math.ceil(briefing.length / 4);
    console.log(
      `[compression] ${sessionId}: ~${origEst} tokens → ~${briefEst} tokens ` +
      `(${origEst > 0 ? Math.round((1 - briefEst / origEst) * 100) : 0}% reduction) in ${elapsed}ms`
    );

    return { briefingPath, elapsed, originalChars: userMessage.length, briefingChars: briefing.length };
  } catch (err) {
    console.warn(`[compression] error: ${err.message}`);
    return null;
  }
}

function cleanExpiredBriefings() {
  try {
    if (!fs.existsSync(ESCALATION_CACHE_DIR)) return;
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    let cleaned = 0;
    for (const file of fs.readdirSync(ESCALATION_CACHE_DIR)) {
      if (!file.startsWith("escalation-")) continue;
      const fp = path.join(ESCALATION_CACHE_DIR, file);
      try {
        if (now - fs.statSync(fp).mtimeMs > maxAge) { fs.unlinkSync(fp); cleaned++; }
      } catch { /* skip */ }
    }
    if (cleaned > 0) console.log(`[compression] cleaned ${cleaned} expired briefing(s)`);
  } catch { /* skip */ }
}

// Run cleanup periodically (every 6 hours), not on every request
setInterval(cleanExpiredBriefings, 6 * 60 * 60 * 1000);

function buildCompressedMessage(compression) {
  return [
    `A task briefing has been prepared for you at: ${compression.briefingPath}`,
    "",
    "Read that file first. It contains:",
    "- The task objective and type",
    "- Relevant context and workspace paths",
    "- Constraints and a suggested approach",
    "- The user's complete original request",
    "",
    "Execute the task as described in the briefing. If the briefing is unclear, refer to the Original Request section for the user's exact words.",
  ].join("\n");
}

/**
 * Phase 1: Triage only (no side effects). Safe to call before quota checks.
 */
function triageAndSelect(message) {
  const pool = readModelPool();
  return triagePrompt(message).then((triage) => {
    const triageModel = selectModelByTier(pool, triage.tier, triage.modelType);
    return { triage, triageModel, pool };
  });
}

/**
 * Phase 2: Compress + model-switch (has side effects). Call after quota check passes.
 * Compression and model switch run in parallel for minimal latency.
 */
async function prepareForAgent(message, sessionId, triage, triageModel, pool) {
  const isEscalation = triage.tier !== "free";

  // Start compression in parallel with model switch (only for paid tiers)
  const compressionPromise = isEscalation
    ? compressPromptForEscalation(message, triage, sessionId)
    : Promise.resolve(null);

  // Model switch
  let previousModel = null;
  if (triageModel) {
    const currentModelRes = await runCmd(OPENCLAW_NODE, clawArgs(["models"]));
    const currentMatch = currentModelRes.output.match(/Default\s*:\s*(.+)/);
    previousModel = currentMatch ? currentMatch[1].trim() : null;
    if (previousModel !== triageModel.id) {
      await runCmd(OPENCLAW_NODE, clawArgs(["models", "set", triageModel.id]));
    }
    triageModel.usedToday++;
    writeModelPool(pool);
  }

  const compression = await compressionPromise;

  const agentMessage = compression
    ? buildCompressedMessage(compression)
    : message.trim().slice(0, 10000);

  return { previousModel, compression, agentMessage };
}

// ── Auto-scheduler background loop ─────────────────────────────────────

let schedulerTimer = null;
let schedulerRunning = false;

function isInPauseWindow(scheduler) {
  if (!scheduler.pauseStart || !scheduler.pauseEnd) return false;
  try {
    const tz = scheduler.timezone || "America/Chicago";
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    const nowTime = fmt.format(now);
    const [h, m] = nowTime.split(":").map(Number);
    const nowMins = h * 60 + m;
    const [sh, sm] = scheduler.pauseStart.split(":").map(Number);
    const [eh, em] = scheduler.pauseEnd.split(":").map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    if (startMins <= endMins) return nowMins >= startMins && nowMins < endMins;
    return nowMins >= startMins || nowMins < endMins; // crosses midnight
  } catch { return false; }
}

async function schedulerTick() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  try {
    const queue = readTaskQueue();
    const pool = readModelPool();
    const sched = pool.scheduler;

    if (!sched.enabled || queue.config.paused) { schedulerRunning = false; return; }
    if (isInPauseWindow(sched)) { schedulerRunning = false; return; }

    // Check daily task limit
    const today = new Date().toISOString().slice(0, 10);
    const tasksToday = queue.history.filter(
      (t) => t.completedAt && t.completedAt.startsWith(today)
    ).length;
    if (tasksToday >= queue.config.dailyTaskLimit) { schedulerRunning = false; return; }

    // Count currently running tasks
    const running = queue.tasks.filter((t) => t.status === "running").length;
    if (running >= (sched.maxConcurrent || 1)) { schedulerRunning = false; return; }

    // Get next pending task (sorted by priority, lowest number = highest priority)
    const pending = queue.tasks
      .filter((t) => t.status === "pending")
      .sort((a, b) => (a.priority || 5) - (b.priority || 5));

    if (pending.length === 0) { schedulerRunning = false; return; }

    const task = pending[0];
    const taskPriority = task.priority || 5;

    // Select model
    const model = selectModelForTask(pool, taskPriority);
    if (!model) {
      console.log(`[scheduler] No available model for task ${task.id} (priority ${taskPriority})`);
      schedulerRunning = false;
      return;
    }

    console.log(`[scheduler] Assigning task "${task.title}" to model ${model.id} (priority ${taskPriority}, cost $${model.costPer1kTokens}/1k)`);

    // Mark task as running
    task.status = "running";
    task.startedAt = new Date().toISOString();
    task.assignedModel = model.id;
    writeTaskQueue(queue);

    // Increment model usage
    model.usedToday++;
    writeModelPool(pool);

    appendActivity("scheduler_dispatch", {
      id: task.id,
      title: task.title,
      model: model.id,
      strategy: sched.strategy,
      priority: taskPriority,
    });

    // Switch model before running
    const currentModel = queue.config.engines?.openclaw?.model;
    let switched = false;
    if (currentModel !== model.id) {
      const switchRes = await runCmd(OPENCLAW_NODE, clawArgs(["models", "set", model.id]));
      switched = switchRes.code === 0;
      if (!switched) console.warn(`[scheduler] Failed to switch to ${model.id}, using current model`);
    }

    // Execute
    const timeout = queue.config.engines?.openclaw?.timeout || 180;
    const projectPath = task.project ? task.project.split("/").pop() : "";
    const prompt = [
      task.title,
      task.description ? `\nDetails: ${task.description}` : "",
      projectPath ? `\nWork in the ${projectPath} project directory.` : "",
    ].join("");

    const agentArgs = [
      "agent", "--session-id", `sched-${task.id.slice(0, 8)}`,
      "--message", prompt,
      "--timeout", String(timeout),
    ];

    runCmd(OPENCLAW_NODE, clawArgs(agentArgs)).then((r) => {
      const q2 = readTaskQueue();
      const t2 = q2.tasks.find((t) => t.id === task.id);
      if (t2) {
        t2.status = r.code === 0 ? "completed" : "failed";
        t2.completedAt = new Date().toISOString();
        t2.result = (r.output || "").slice(-2000);
        t2.executedModel = model.id;
        q2.tasks = q2.tasks.filter((t) => t.id !== task.id);
        q2.history.push(t2);
        if (q2.history.length > 500) q2.history = q2.history.slice(-500);
        writeTaskQueue(q2);
        appendActivity("scheduler_completed", {
          id: t2.id, title: t2.title, model: model.id,
          status: t2.status, exit: r.code,
        });
      }
      // Restore original model if we switched
      if (switched && currentModel) {
        runCmd(OPENCLAW_NODE, clawArgs(["models", "set", currentModel])).catch(() => {});
      }
    }).catch((err) => {
      const q2 = readTaskQueue();
      const t2 = q2.tasks.find((t) => t.id === task.id);
      if (t2) {
        t2.status = "failed";
        t2.completedAt = new Date().toISOString();
        t2.result = err.message;
        t2.executedModel = model.id;
        q2.tasks = q2.tasks.filter((t) => t.id !== task.id);
        q2.history.push(t2);
        if (q2.history.length > 500) q2.history = q2.history.slice(-500);
        writeTaskQueue(q2);
        appendActivity("scheduler_failed", { id: t2.id, title: t2.title, model: model.id, error: err.message });
      }
      if (switched && currentModel) {
        runCmd(OPENCLAW_NODE, clawArgs(["models", "set", currentModel])).catch(() => {});
      }
    });
  } catch (err) {
    console.error("[scheduler] tick error:", err.message);
  } finally {
    schedulerRunning = false;
  }
}

function startScheduler() {
  const pool = readModelPool();
  if (!pool.scheduler.enabled) {
    console.log("[scheduler] Disabled, not starting");
    return;
  }
  const interval = (pool.scheduler.intervalSeconds || 600) * 1000;
  console.log(`[scheduler] Starting with ${interval / 1000}s interval, strategy: ${pool.scheduler.strategy}`);
  stopScheduler();
  schedulerTimer = setInterval(schedulerTick, interval);
  // Run first tick after 30s delay (let gateway warm up)
  setTimeout(schedulerTick, 30000);
}

function stopScheduler() {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
}

function restartScheduler() {
  stopScheduler();
  startScheduler();
}

// ── Activity Log (with user attribution + filtering) ────────────────────
const ACTIVITY_LOG_PATH = path.join(STATE_DIR, "activity-log.json");
const ACTIVITY_LOG_MAX = 2000;

// SSE clients for real-time event streaming
const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

function appendActivity(type, detail, user) {
  let log = [];
  try {
    log = JSON.parse(fs.readFileSync(ACTIVITY_LOG_PATH, "utf8"));
    if (!Array.isArray(log)) log = [];
  } catch { log = []; }
  const entry = {
    id: crypto.randomUUID(),
    type,
    detail,
    user: user ? { id: user.id, username: user.username, role: user.role } : null,
    ts: new Date().toISOString(),
  };
  log.push(entry);
  if (log.length > ACTIVITY_LOG_MAX) log = log.slice(-ACTIVITY_LOG_MAX);
  try { fs.writeFileSync(ACTIVITY_LOG_PATH, JSON.stringify(log)); } catch (e) {
    console.warn("[activity-log] write error:", e.message);
  }
  // Broadcast to SSE clients
  broadcastSSE("activity", entry);
  // Check alert rules
  checkAlertRules(entry);
}

function readActivityLog(limit = 100) {
  try {
    const log = JSON.parse(fs.readFileSync(ACTIVITY_LOG_PATH, "utf8"));
    if (!Array.isArray(log)) return [];
    return log.slice(-limit);
  } catch { return []; }
}

function filterActivityLog({ limit = 100, user, type, from, to, search }) {
  let log = readActivityLog(ACTIVITY_LOG_MAX);
  if (user) log = log.filter(e => e.user?.username === user || e.user?.id === user);
  if (type) log = log.filter(e => e.type === type || e.type.includes(type));
  if (from) log = log.filter(e => e.ts >= from);
  if (to) log = log.filter(e => e.ts <= to);
  if (search) {
    const q = search.toLowerCase();
    log = log.filter(e =>
      e.type.toLowerCase().includes(q) ||
      JSON.stringify(e.detail || {}).toLowerCase().includes(q) ||
      (e.user?.username || "").toLowerCase().includes(q)
    );
  }
  return log.slice(-limit);
}

// ── Alert System ────────────────────────────────────────────────────────
const ALERT_CONFIG_PATH = path.join(STATE_DIR, "alert-config.json");

function readAlertConfig() {
  try {
    return JSON.parse(fs.readFileSync(ALERT_CONFIG_PATH, "utf8"));
  } catch {
    return {
      telegram: { enabled: false, botToken: "", chatId: "" },
      rules: [
        { id: "gateway_down", type: "gateway_error", severity: "critical", enabled: true },
        { id: "task_failed", type: "task_failed", severity: "warning", enabled: true },
        { id: "quota_exceeded", type: "quota_exceeded", severity: "info", enabled: true },
        { id: "auth_failure", type: "auth_failure", severity: "warning", enabled: true },
      ],
      cooldownMinutes: 5,
      lastAlerts: {},
    };
  }
}

function writeAlertConfig(config) {
  fs.writeFileSync(ALERT_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function sendTelegramAlert(message) {
  const config = readAlertConfig();
  if (!config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    console.warn("[telegram-alert] send failed:", err.message);
  }
}

function checkAlertRules(entry) {
  const config = readAlertConfig();
  if (!config.telegram.enabled) return;
  for (const rule of config.rules) {
    if (!rule.enabled) continue;
    if (entry.type === rule.type || entry.type.includes(rule.type)) {
      const lastAlert = config.lastAlerts[rule.id];
      const cooldown = (config.cooldownMinutes || 5) * 60 * 1000;
      if (lastAlert && Date.now() - new Date(lastAlert).getTime() < cooldown) continue;
      config.lastAlerts[rule.id] = new Date().toISOString();
      writeAlertConfig(config);
      const icon = rule.severity === "critical" ? "🚨" : rule.severity === "warning" ? "⚠️" : "ℹ️";
      const msg = `${icon} *JClaw Alert*\n*Type:* ${entry.type}\n*Detail:* ${JSON.stringify(entry.detail || {}).slice(0, 500)}\n*User:* ${entry.user?.username || "system"}\n*Time:* ${entry.ts}`;
      sendTelegramAlert(msg);
    }
  }
}

// ── API Token Management ────────────────────────────────────────────────
const API_TOKENS_PATH = path.join(STATE_DIR, "api-tokens.json");

function readApiTokens() {
  try {
    const data = JSON.parse(fs.readFileSync(API_TOKENS_PATH, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function writeApiTokens(tokens) {
  fs.writeFileSync(API_TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

function validateApiToken(token) {
  const tokens = readApiTokens();
  return tokens.find(t => t.token === token && !t.revoked);
}

// ── BYOK (Bring Your Own Key) Management ────────────────────────────────
const USER_API_KEYS_PATH = path.join(STATE_DIR, "user-api-keys.json");

const BYOK_PROVIDERS = {
  openai:      { envVar: "OPENAI_API_KEY",          label: "OpenAI",      prefix: "sk-" },
  anthropic:   { envVar: "ANTHROPIC_API_KEY",       label: "Anthropic",   prefix: "sk-ant-" },
  openrouter:  { envVar: "OPENROUTER_API_TOKEN",    label: "OpenRouter",  prefix: "sk-or-" },
  gemini:      { envVar: "GEMINI_API_KEY",          label: "Google Gemini", prefix: "" },
  xai:         { envVar: "XAI_API_KEY",             label: "xAI/Grok",   prefix: "" },
};

function readUserApiKeys() {
  try {
    return JSON.parse(fs.readFileSync(USER_API_KEYS_PATH, "utf8"));
  } catch { return { users: {} }; }
}

function writeUserApiKeys(data) {
  fs.writeFileSync(USER_API_KEYS_PATH, JSON.stringify(data, null, 2));
}

function getUserApiKeys(userId) {
  const data = readUserApiKeys();
  return data.users[userId] || { keys: {}, quotas: null };
}

function setUserApiKey(userId, provider, apiKey, label) {
  const data = readUserApiKeys();
  if (!data.users[userId]) data.users[userId] = { keys: {}, quotas: null };
  data.users[userId].keys[provider] = {
    apiKey,
    label: label || BYOK_PROVIDERS[provider]?.label || provider,
    addedAt: new Date().toISOString(),
  };
  writeUserApiKeys(data);
}

function removeUserApiKey(userId, provider) {
  const data = readUserApiKeys();
  if (data.users[userId]?.keys) {
    delete data.users[userId].keys[provider];
    writeUserApiKeys(data);
  }
}

function setUserQuotaOverrides(userId, quotas) {
  const data = readUserApiKeys();
  if (!data.users[userId]) data.users[userId] = { keys: {}, quotas: null };
  data.users[userId].quotas = quotas;
  writeUserApiKeys(data);
}

function userHasByokKey(userId, provider) {
  const userKeys = getUserApiKeys(userId);
  return !!userKeys.keys[provider]?.apiKey;
}

// Build env overrides for a BYOK user's agent process
function buildByokEnv(userId) {
  const userKeys = getUserApiKeys(userId);
  const envOverrides = {};
  for (const [provider, keyData] of Object.entries(userKeys.keys || {})) {
    const providerInfo = BYOK_PROVIDERS[provider];
    if (providerInfo && keyData.apiKey) {
      envOverrides[providerInfo.envVar] = keyData.apiKey;
    }
  }
  return envOverrides;
}

// ── Per-Endpoint Rate Limiting ──────────────────────────────────────────
function createRateLimiter(windowMs, maxRequests) {
  const store = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of store) {
      if (now - val.windowStart > windowMs) store.delete(key);
    }
  }, windowMs);
  return {
    check(key) {
      const now = Date.now();
      const entry = store.get(key);
      if (!entry || now - entry.windowStart > windowMs) {
        store.set(key, { windowStart: now, count: 1 });
        return { limited: false, remaining: maxRequests - 1 };
      }
      entry.count++;
      if (entry.count > maxRequests) {
        return { limited: true, remaining: 0, retryAfter: Math.ceil((entry.windowStart + windowMs - now) / 1000) };
      }
      return { limited: false, remaining: maxRequests - entry.count };
    },
  };
}

const shellRateLimiter = createRateLimiter(60_000, 10); // 10 requests per minute
const chatRateLimiter  = createRateLimiter(60_000, 30); // 30 requests per minute
const apiRateLimiter   = createRateLimiter(60_000, 20); // 20 requests per minute

// ── Dashboard User/RBAC System ──────────────────────────────────────────
const USERS_PATH = path.join(STATE_DIR, "dashboard-users.json");

const ROLES = {
  "limited-read": { level: 1, label: "Limited Read", permissions: ["view:overview", "view:projects", "view:models"] },
  "read": { level: 2, label: "Read", permissions: ["view:overview", "view:projects", "view:models", "view:skills", "view:tools", "view:sessions", "view:runner", "view:cron", "view:reports"] },
  "read-write": { level: 3, label: "Read & Write", permissions: ["view:*", "edit:projects", "edit:runner", "edit:sessions", "edit:cron"] },
  "admin": { level: 4, label: "Admin", permissions: ["view:*", "edit:*", "manage:skills", "manage:tools", "manage:models", "manage:scheduler"] },
  "super-admin": { level: 5, label: "Super Admin", permissions: ["view:*", "edit:*", "manage:*", "admin:gateway", "admin:config"] },
  "owner": { level: 6, label: "Owner", permissions: ["*"] },
};

// Per-role model quotas: owner gets unlimited, others get tiered access
const ROLE_MODEL_QUOTAS = {
  "owner":         { paidRequestsPerDay: Infinity, freeRequestsPerDay: Infinity, maxConcurrentSessions: 10 },
  "super-admin":   { paidRequestsPerDay: 50,       freeRequestsPerDay: Infinity, maxConcurrentSessions: 5 },
  "admin":         { paidRequestsPerDay: 25,        freeRequestsPerDay: Infinity, maxConcurrentSessions: 4 },
  "read-write":    { paidRequestsPerDay: 10,        freeRequestsPerDay: Infinity, maxConcurrentSessions: 3 },
  "read":          { paidRequestsPerDay: 3,         freeRequestsPerDay: 100,      maxConcurrentSessions: 2 },
  "limited-read":  { paidRequestsPerDay: 0,         freeRequestsPerDay: 50,       maxConcurrentSessions: 1 },
};

// ── Per-User Usage Tracking ─────────────────────────────────────────────
const USER_USAGE_PATH = path.join(STATE_DIR, "user-usage.json");

function readUserUsage() {
  try {
    return JSON.parse(fs.readFileSync(USER_USAGE_PATH, "utf8"));
  } catch {
    return { users: {}, resetDate: new Date().toISOString().slice(0, 10) };
  }
}

function writeUserUsage(usage) {
  fs.writeFileSync(USER_USAGE_PATH, JSON.stringify(usage, null, 2));
}

function getUserUsageToday(userId) {
  const usage = readUserUsage();
  const today = new Date().toISOString().slice(0, 10);
  if (usage.resetDate !== today) {
    usage.users = {};
    usage.resetDate = today;
    writeUserUsage(usage);
  }
  if (!usage.users[userId]) {
    usage.users[userId] = { paidRequests: 0, freeRequests: 0, activeSessions: [] };
  }
  return usage.users[userId];
}

function incrementUserUsage(userId, modelTier) {
  const usage = readUserUsage();
  const today = new Date().toISOString().slice(0, 10);
  if (usage.resetDate !== today) { usage.users = {}; usage.resetDate = today; }
  if (!usage.users[userId]) { usage.users[userId] = { paidRequests: 0, freeRequests: 0, activeSessions: [] }; }
  if (modelTier === "free") {
    usage.users[userId].freeRequests++;
  } else {
    usage.users[userId].paidRequests++;
  }
  writeUserUsage(usage);
  return usage.users[userId];
}

function checkUserQuota(userId, role, modelTier) {
  // Owner always gets unlimited access
  if (role === "owner") return { allowed: true };

  // Check if BYOK user has custom quota overrides
  const userKeyData = getUserApiKeys(userId);
  const hasByokKeys = Object.keys(userKeyData.keys || {}).length > 0;
  const customQuotas = userKeyData.quotas;

  // BYOK users with custom quotas use their own limits (they pay their own costs)
  const quotas = (hasByokKeys && customQuotas)
    ? customQuotas
    : (ROLE_MODEL_QUOTAS[role] || ROLE_MODEL_QUOTAS["limited-read"]);

  const userUsage = getUserUsageToday(userId);
  if (modelTier === "free") {
    const limit = quotas.freeRequestsPerDay ?? Infinity;
    if (limit !== -1 && userUsage.freeRequests >= limit) {
      return { allowed: false, reason: `Free model daily limit reached (${limit})` };
    }
  } else {
    // Non-owner without BYOK keys cannot use paid models (instance keys are owner-only)
    if (!hasByokKeys && role !== "owner") {
      const roleLimit = (ROLE_MODEL_QUOTAS[role] || ROLE_MODEL_QUOTAS["limited-read"]).paidRequestsPerDay;
      if (roleLimit === 0) {
        return { allowed: false, reason: "Paid models require your own API key. Add one in Settings → API Keys." };
      }
    }
    const limit = quotas.paidRequestsPerDay ?? 0;
    if (limit !== -1 && limit !== Infinity && userUsage.paidRequests >= limit) {
      return { allowed: false, reason: `Paid model daily limit reached (${limit}). ${hasByokKeys ? "Adjust your quota in Settings." : "Try a free model or add your own API key."}` };
    }
  }
  return { allowed: true };
}

// ── Concurrent Session Tracking ─────────────────────────────────────────
const activeSessions = new Map(); // userId → Set of sessionIds

function trackSession(userId, sessionId) {
  if (!activeSessions.has(userId)) activeSessions.set(userId, new Set());
  activeSessions.get(userId).add(sessionId);
}

function untrackSession(userId, sessionId) {
  if (activeSessions.has(userId)) {
    activeSessions.get(userId).delete(sessionId);
    if (activeSessions.get(userId).size === 0) activeSessions.delete(userId);
  }
}

function getUserSessionCount(userId) {
  return activeSessions.has(userId) ? activeSessions.get(userId).size : 0;
}

function checkConcurrentLimit(userId, role) {
  const quotas = ROLE_MODEL_QUOTAS[role] || ROLE_MODEL_QUOTAS["limited-read"];
  const count = getUserSessionCount(userId);
  if (count >= quotas.maxConcurrentSessions) {
    return { allowed: false, reason: `Concurrent session limit reached (${quotas.maxConcurrentSessions})` };
  }
  return { allowed: true };
}

function readUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_PATH, "utf8"));
    if (!data.users || !Array.isArray(data.users)) throw new Error("invalid");
    return data;
  } catch {
    // Create default owner using SETUP_PASSWORD
    const defaults = {
      users: [{
        id: crypto.randomUUID(),
        username: "owner",
        passwordHash: crypto.createHash("sha256").update(SETUP_PASSWORD || "admin").digest("hex"),
        role: "owner",
        displayName: "Joe",
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
        enabled: true,
      }],
      sessions: [],
    };
    fs.writeFileSync(USERS_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}

function writeUsers(data) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2));
}

function authenticateUser(username, password) {
  const data = readUsers();
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  return data.users.find(u => u.username === username && u.passwordHash === hash && u.enabled);
}

function createSession(userId) {
  const data = readUsers();
  const token = `jclaw_dash_${crypto.randomBytes(24).toString("hex")}`;
  const session = {
    token,
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  data.sessions = (data.sessions || []).filter(s => new Date(s.expiresAt) > new Date());
  data.sessions.push(session);
  writeUsers(data);
  return token;
}

function validateSession(token) {
  if (!token) return null;
  const data = readUsers();
  const session = (data.sessions || []).find(s => s.token === token && new Date(s.expiresAt) > new Date());
  if (!session) return null;
  const user = data.users.find(u => u.id === session.userId && u.enabled);
  if (!user) return null;
  return { ...user, sessionToken: token };
}

function userHasPermission(user, permission) {
  if (!user) return false;
  const role = ROLES[user.role];
  if (!role) return false;
  if (role.permissions.includes("*")) return true;
  if (role.permissions.includes(permission)) return true;
  const [action] = permission.split(":");
  return role.permissions.includes(`${action}:*`);
}

// Middleware: require dashboard session OR fall back to Basic auth (owner level)
function requireDashAuth(req, res, next) {
  // Check for dashboard session token (cookie or header)
  const cookieToken = (req.headers.cookie || "").split(";").map(c => c.trim()).find(c => c.startsWith("jclaw_session="));
  const sessionToken = cookieToken ? cookieToken.split("=")[1] : req.headers["x-dashboard-token"];
  const user = validateSession(sessionToken);
  if (user) {
    req.dashUser = user;
    return next();
  }
  // Fall back to Basic auth (treated as owner)
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const password = idx >= 0 ? decoded.slice(idx + 1) : "";
    if (SETUP_PASSWORD && password === SETUP_PASSWORD) {
      req.dashUser = { id: "basic-auth", username: "owner", role: "owner", displayName: "Owner" };
      return next();
    }
  }
  return res.status(401).json({ ok: false, error: "Authentication required", loginUrl: "/dashboard/login" });
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!userHasPermission(req.dashUser, permission)) {
      return res.status(403).json({ ok: false, error: "Insufficient permissions" });
    }
    return next();
  };
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

  // Also accept dashboard session cookies (so SvelteKit dashboard API calls work)
  const cookieToken = (req.headers.cookie || "").split(";").map(c => c.trim()).find(c => c.startsWith("jclaw_session="));
  const sessionToken = cookieToken ? cookieToken.split("=")[1] : req.headers["x-dashboard-token"];
  const sessionUser = validateSession(sessionToken);
  if (sessionUser) {
    req.dashUser = sessionUser;
    return next();
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="JClaw Setup"');
    return res.status(401).send("Auth required");
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const password = idx >= 0 ? decoded.slice(idx + 1) : "";
  const passwordHash = crypto.createHash("sha256").update(password).digest();
  const expectedHash = crypto.createHash("sha256").update(SETUP_PASSWORD).digest();
  const isValid = crypto.timingSafeEqual(passwordHash, expectedHash);
  if (!isValid) {
    res.set("WWW-Authenticate", 'Basic realm="JClaw Setup"');
    return res.status(401).send("Invalid password");
  }
  req.dashUser = { id: "basic-auth", username: "owner", role: "owner", displayName: "Owner" };
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
  res.json({
    ok: true,
    gateway,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) || null,
    uptime: Math.floor(process.uptime()),
  });
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

  const mem = process.memoryUsage();
  res.json({
    ok: true,
    wrapper: true,
    configured,
    gatewayRunning,
    gatewayStarting: starting,
    gatewayReachable,
    version: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
    uptime: Math.floor(process.uptime()),
    memoryMB: Math.floor(mem.rss / 1024 / 1024),
    heapUsedMB: Math.floor(mem.heapUsed / 1024 / 1024),
    nodeVersion: process.version,
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
      railwayDeploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
      railwayServiceId: process.env.RAILWAY_SERVICE_ID || null,
      railwayEnvironmentId: process.env.RAILWAY_ENVIRONMENT_ID || null,
      railwayPublicDomain: process.env.RAILWAY_PUBLIC_DOMAIN || null,
      railwayPrivateDomain: process.env.RAILWAY_PRIVATE_DOMAIN || null,
      railwayVolumeMountPath: process.env.RAILWAY_VOLUME_MOUNT_PATH || null,
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
    appendActivity("gateway_restart", { success: true });
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
  // Shell API is restricted to owner role only
  if (req.dashUser?.role !== "owner") {
    return res.status(403).json({ ok: false, error: "Shell API is restricted to owner role" });
  }

  // Rate limit: 10 requests per minute even for owner
  const rlKey = req.dashUser?.id || req.ip || "unknown";
  const rl = shellRateLimiter.check(rlKey);
  if (rl.limited) {
    return res.status(429).json({ ok: false, error: `Rate limited. Retry in ${rl.retryAfter}s.` });
  }

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
app.get("/setup/api/runner/queue", requireDashAuth, (_req, res) => {
  const queue = readTaskQueue();
  return res.json({ ok: true, tasks: queue.tasks, config: queue.config });
});

// Add a task to the queue
app.post("/setup/api/runner/add", requireDashAuth, (req, res) => {
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
  appendActivity("task_added", { id: task.id, title: task.title, project: task.project });
  return res.json({ ok: true, task });
});

// Remove a task by id
app.post("/setup/api/runner/remove", requireDashAuth, (req, res) => {
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
app.post("/setup/api/runner/reorder", requireDashAuth, (req, res) => {
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
app.get("/setup/api/runner/status", requireDashAuth, (_req, res) => {
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
app.get("/setup/api/runner/history", requireDashAuth, (_req, res) => {
  const queue = readTaskQueue();
  const history = (queue.history || []).slice(-50);
  return res.json({ ok: true, history });
});

// Update runner config (whitelist-based merge to prevent prototype pollution)
app.post("/setup/api/runner/config", requireDashAuth, (req, res) => {
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
app.post("/setup/api/runner/pause", requireDashAuth, (req, res) => {
  const { paused } = req.body || {};
  if (typeof paused !== "boolean") {
    return res.status(400).json({ ok: false, error: "Missing required field: paused (boolean)" });
  }
  const queue = readTaskQueue();
  queue.config.paused = paused;
  writeTaskQueue(queue);
  return res.json({ ok: true, paused: queue.config.paused });
});

// ── Model Pool & Scheduler API ──────────────────────────────────────────

app.get("/setup/api/scheduler/pool", requireSetupAuth, (_req, res) => {
  const pool = readModelPool();
  resetDailyCountsIfNeeded(pool);
  writeModelPool(pool);
  return res.json({ ok: true, ...pool, schedulerActive: !!schedulerTimer });
});

app.post("/setup/api/scheduler/pool", requireSetupAuth, (req, res) => {
  const { models, scheduler } = req.body || {};
  const pool = readModelPool();
  if (Array.isArray(models)) {
    pool.models = models.filter((m) => m && typeof m.id === "string").slice(0, 20).map((m) => ({
      id: String(m.id).slice(0, 100),
      provider: String(m.provider || "").slice(0, 50),
      tier: String(m.tier || "standard").slice(0, 20),
      costPer1kTokens: Math.max(0, Number(m.costPer1kTokens) || 0),
      dailyLimit: Math.max(1, Math.min(200, Number(m.dailyLimit) || 20)),
      usedToday: Math.max(0, Number(m.usedToday) || 0),
      lastResetDate: m.lastResetDate || "",
      enabled: m.enabled !== false,
      priority: Math.max(1, Math.min(20, Number(m.priority) || 5)),
      minTaskPriority: Math.max(1, Math.min(10, Number(m.minTaskPriority) || 1)),
      maxTaskPriority: Math.max(1, Math.min(10, Number(m.maxTaskPriority) || 10)),
      capabilities: Array.isArray(m.capabilities) ? m.capabilities.filter((c) => typeof c === "string").slice(0, 10) : [],
    }));
  }
  if (scheduler && typeof scheduler === "object") {
    const s = pool.scheduler;
    if (typeof scheduler.enabled === "boolean") s.enabled = scheduler.enabled;
    if (typeof scheduler.intervalSeconds === "number") s.intervalSeconds = Math.max(60, Math.min(86400, scheduler.intervalSeconds));
    if (typeof scheduler.strategy === "string") s.strategy = ["cost-optimized", "round-robin", "quality-first", "cheapest-first"].includes(scheduler.strategy) ? scheduler.strategy : s.strategy;
    if (typeof scheduler.maxConcurrent === "number") s.maxConcurrent = Math.max(1, Math.min(5, scheduler.maxConcurrent));
    if (typeof scheduler.pauseStart === "string") s.pauseStart = scheduler.pauseStart.slice(0, 5);
    if (typeof scheduler.pauseEnd === "string") s.pauseEnd = scheduler.pauseEnd.slice(0, 5);
    if (typeof scheduler.timezone === "string") s.timezone = scheduler.timezone.slice(0, 50);
  }
  writeModelPool(pool);
  restartScheduler();
  appendActivity("scheduler_config_updated", { modelsCount: pool.models.length, enabled: pool.scheduler.enabled, strategy: pool.scheduler.strategy });
  return res.json({ ok: true, ...pool, schedulerActive: !!schedulerTimer });
});

app.post("/setup/api/scheduler/toggle", requireSetupAuth, (_req, res) => {
  const pool = readModelPool();
  pool.scheduler.enabled = !pool.scheduler.enabled;
  writeModelPool(pool);
  if (pool.scheduler.enabled) startScheduler(); else stopScheduler();
  appendActivity("scheduler_toggled", { enabled: pool.scheduler.enabled });
  return res.json({ ok: true, enabled: pool.scheduler.enabled, active: !!schedulerTimer });
});

app.post("/setup/api/scheduler/run-now", requireSetupAuth, async (_req, res) => {
  if (schedulerRunning) return res.json({ ok: false, error: "Scheduler tick already in progress" });
  schedulerTick();
  return res.json({ ok: true, message: "Scheduler tick triggered" });
});

app.get("/setup/api/scheduler/status", requireSetupAuth, (_req, res) => {
  const pool = readModelPool();
  resetDailyCountsIfNeeded(pool);
  const queue = readTaskQueue();
  const today = new Date().toISOString().slice(0, 10);
  const tasksToday = queue.history.filter((t) => t.completedAt && t.completedAt.startsWith(today)).length;
  const running = queue.tasks.filter((t) => t.status === "running").length;
  const pending = queue.tasks.filter((t) => t.status === "pending").length;

  return res.json({
    ok: true,
    enabled: pool.scheduler.enabled,
    active: !!schedulerTimer,
    running: schedulerRunning,
    strategy: pool.scheduler.strategy,
    interval: pool.scheduler.intervalSeconds,
    inPauseWindow: isInPauseWindow(pool.scheduler),
    tasksToday,
    dailyLimit: queue.config.dailyTaskLimit,
    runningTasks: running,
    pendingTasks: pending,
    maxConcurrent: pool.scheduler.maxConcurrent,
    models: pool.models.map((m) => ({
      id: m.id,
      tier: m.tier,
      enabled: m.enabled,
      usedToday: m.usedToday,
      dailyLimit: m.dailyLimit,
      remaining: m.dailyLimit - m.usedToday,
      costPer1kTokens: m.costPer1kTokens,
    })),
  });
});

// ── Free Model Scanner ─────────────────────────────────────────────────

const SCANNER_RESULTS_PATH = path.join(STATE_DIR, "scanner-results.json");
const SCANNER_CONFIG_PATH = path.join(STATE_DIR, "scanner-config.json");

function readScannerConfig() {
  try {
    return JSON.parse(fs.readFileSync(SCANNER_CONFIG_PATH, "utf8"));
  } catch {
    const defaults = {
      autoScanEnabled: false,
      autoScanIntervalHours: 24,
      lastScanAt: null,
      minContextLength: 8000,
      requiredModalities: ["text"],
      preferCapabilities: ["code", "analysis"],
      maxAutoAdd: 3,
      autoAddEnabled: false,
      blocklist: [],
      approvedModels: [],
    };
    fs.writeFileSync(SCANNER_CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}

function writeScannerConfig(config) {
  fs.writeFileSync(SCANNER_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function readScannerResults() {
  try {
    return JSON.parse(fs.readFileSync(SCANNER_RESULTS_PATH, "utf8"));
  } catch {
    return { models: [], scannedAt: null, totalFreeFound: 0, alreadyInPool: 0, newCandidates: 0 };
  }
}

function writeScannerResults(results) {
  fs.writeFileSync(SCANNER_RESULTS_PATH, JSON.stringify(results, null, 2));
}

function scoreModel(model, config) {
  let score = 0;
  const reasons = [];

  // Context length scoring (bigger = better for coding tasks)
  const ctx = model.context_length || 0;
  if (ctx >= 128000) { score += 30; reasons.push("128k+ context"); }
  else if (ctx >= 32000) { score += 20; reasons.push("32k+ context"); }
  else if (ctx >= 16000) { score += 10; reasons.push("16k+ context"); }
  else if (ctx >= config.minContextLength) { score += 5; }
  else { return { score: -1, reasons: ["context too small"] }; }

  // Modality check
  const inputMods = model.architecture?.input_modalities || [];
  const outputMods = model.architecture?.output_modalities || [];
  const hasTextInput = inputMods.includes("text");
  const hasTextOutput = outputMods.includes("text");
  if (!hasTextInput || !hasTextOutput) {
    return { score: -1, reasons: ["no text I/O"] };
  }
  if (inputMods.includes("image")) { score += 5; reasons.push("multimodal"); }

  // Prefer known-good model families
  const id = model.id.toLowerCase();
  const knownGood = [
    "qwen", "deepseek", "llama", "gemma", "mistral", "phi",
    "codestral", "starcoder", "solar", "nemotron", "yi",
  ];
  for (const kw of knownGood) {
    if (id.includes(kw)) { score += 15; reasons.push(`known family: ${kw}`); break; }
  }

  // Coding capability inference from description
  const desc = (model.description || "").toLowerCase();
  const codingKeywords = ["code", "programming", "developer", "software", "coding", "technical"];
  const codingHits = codingKeywords.filter((kw) => desc.includes(kw));
  if (codingHits.length > 0) {
    score += codingHits.length * 5;
    reasons.push(`coding signals: ${codingHits.join(", ")}`);
  }

  // Prefer models with reasoning capability
  if (desc.includes("reason") || desc.includes("thinking") || desc.includes("chain-of-thought")) {
    score += 10;
    reasons.push("reasoning capability");
  }

  // Max completion tokens (higher = more useful for code generation)
  const maxComp = model.top_provider?.max_completion_tokens || 0;
  if (maxComp >= 16384) { score += 10; reasons.push(`${maxComp} max output`); }
  else if (maxComp >= 4096) { score += 5; reasons.push(`${maxComp} max output`); }

  // Moderation preference (moderated = safer)
  if (model.top_provider?.is_moderated) { score += 5; reasons.push("moderated"); }

  // Recency (prefer newer models)
  const created = model.created || 0;
  const ageMs = Date.now() - created * 1000;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 30) { score += 15; reasons.push("very recent"); }
  else if (ageDays < 90) { score += 10; reasons.push("recent"); }
  else if (ageDays < 180) { score += 5; reasons.push("fairly recent"); }

  // Penalize expiring models
  if (model.expiration_date) {
    const expiry = new Date(model.expiration_date);
    const daysUntilExpiry = (expiry - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysUntilExpiry < 7) { return { score: -1, reasons: ["expiring soon"] }; }
    if (daysUntilExpiry < 30) { score -= 10; reasons.push("expiring within 30d"); }
  }

  return { score, reasons };
}

async function scanForFreeModels() {
  const config = readScannerConfig();
  const pool = readModelPool();
  const existingIds = new Set(pool.models.map((m) => m.id));

  // Fetch OpenRouter model list
  const resp = await fetch("https://openrouter.ai/api/v1/models");
  if (!resp.ok) throw new Error(`OpenRouter API returned ${resp.status}`);
  const data = await resp.json();
  const allModels = data.data || [];

  // Filter to free models
  const freeModels = allModels.filter((m) => {
    const p = m.pricing || {};
    return p.prompt === "0" && p.completion === "0";
  });

  // Score and rank
  const scored = freeModels
    .map((m) => {
      const { score, reasons } = scoreModel(m, config);
      return {
        id: m.id,
        name: m.name,
        contextLength: m.context_length,
        maxOutputTokens: m.top_provider?.max_completion_tokens || null,
        inputModalities: m.architecture?.input_modalities || [],
        outputModalities: m.architecture?.output_modalities || [],
        isModerated: m.top_provider?.is_moderated || false,
        created: m.created,
        expirationDate: m.expiration_date || null,
        score,
        reasons,
        inPool: existingIds.has(m.id),
        blocked: config.blocklist.includes(m.id),
        approved: config.approvedModels.includes(m.id),
      };
    })
    .filter((m) => m.score >= 0 && !m.blocked)
    .sort((a, b) => b.score - a.score);

  const newCandidates = scored.filter((m) => !m.inPool);
  const alreadyInPool = scored.filter((m) => m.inPool);

  const results = {
    models: scored,
    scannedAt: new Date().toISOString(),
    totalFreeFound: freeModels.length,
    totalEvaluated: scored.length + freeModels.filter((m) => scoreModel(m, config).score < 0).length,
    filtered: freeModels.length - scored.length,
    alreadyInPool: alreadyInPool.length,
    newCandidates: newCandidates.length,
    topRecommendations: newCandidates.slice(0, 10).map((m) => ({
      id: m.id,
      name: m.name,
      score: m.score,
      contextLength: m.contextLength,
      maxOutputTokens: m.maxOutputTokens,
      reasons: m.reasons,
    })),
  };

  writeScannerResults(results);
  config.lastScanAt = results.scannedAt;
  writeScannerConfig(config);

  return results;
}

// Scan for free models
app.post("/setup/api/scanner/scan", requireSetupAuth, async (_req, res) => {
  try {
    const results = await scanForFreeModels();
    return res.json({ ok: true, ...results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Get latest scan results
app.get("/setup/api/scanner/results", requireSetupAuth, (_req, res) => {
  return res.json({ ok: true, ...readScannerResults() });
});

// Get/update scanner config
app.get("/setup/api/scanner/config", requireSetupAuth, (_req, res) => {
  return res.json({ ok: true, config: readScannerConfig() });
});

app.post("/setup/api/scanner/config", requireSetupAuth, (req, res) => {
  const config = readScannerConfig();
  const updates = req.body || {};
  if (typeof updates.autoScanEnabled === "boolean") config.autoScanEnabled = updates.autoScanEnabled;
  if (typeof updates.autoScanIntervalHours === "number") config.autoScanIntervalHours = Math.max(1, Math.min(168, updates.autoScanIntervalHours));
  if (typeof updates.minContextLength === "number") config.minContextLength = Math.max(1000, updates.minContextLength);
  if (typeof updates.maxAutoAdd === "number") config.maxAutoAdd = Math.max(0, Math.min(10, updates.maxAutoAdd));
  if (typeof updates.autoAddEnabled === "boolean") config.autoAddEnabled = updates.autoAddEnabled;
  if (Array.isArray(updates.blocklist)) config.blocklist = updates.blocklist.filter((s) => typeof s === "string");
  writeScannerConfig(config);
  return res.json({ ok: true, config });
});

// Add a scanned model to the pool
app.post("/setup/api/scanner/add", requireSetupAuth, (req, res) => {
  const { modelId } = req.body || {};
  if (!modelId) return res.status(400).json({ ok: false, error: "modelId required" });

  const pool = readModelPool();
  if (pool.models.some((m) => m.id === modelId)) {
    return res.status(409).json({ ok: false, error: "Model already in pool" });
  }

  const scanResults = readScannerResults();
  const scanned = scanResults.models?.find((m) => m.id === modelId);
  if (!scanned) {
    return res.status(404).json({ ok: false, error: "Model not found in scan results. Run a scan first." });
  }

  // Infer capabilities from scan data
  const capabilities = ["code"];
  if (scanned.reasons?.some((r) => r.includes("coding") || r.includes("code"))) capabilities.push("analysis");
  if (scanned.reasons?.some((r) => r.includes("reasoning"))) capabilities.push("planning");
  if (scanned.contextLength >= 32000) capabilities.push("analysis");
  const uniqueCaps = [...new Set(capabilities)];

  const newModel = {
    id: modelId,
    provider: "openrouter",
    tier: "free",
    costPer1kTokens: 0,
    dailyLimit: 50,
    usedToday: 0,
    lastResetDate: "",
    enabled: true,
    priority: pool.models.length + 1,
    minTaskPriority: 5,
    maxTaskPriority: 10,
    capabilities: uniqueCaps,
    addedByScanner: true,
    scanScore: scanned.score,
    addedAt: new Date().toISOString(),
  };

  pool.models.push(newModel);
  writeModelPool(pool);

  // Track as approved
  const config = readScannerConfig();
  if (!config.approvedModels.includes(modelId)) {
    config.approvedModels.push(modelId);
    writeScannerConfig(config);
  }

  return res.json({ ok: true, model: newModel });
});

// Block a model from appearing in future scans
app.post("/setup/api/scanner/block", requireSetupAuth, (req, res) => {
  const { modelId } = req.body || {};
  if (!modelId) return res.status(400).json({ ok: false, error: "modelId required" });
  const config = readScannerConfig();
  if (!config.blocklist.includes(modelId)) {
    config.blocklist.push(modelId);
    writeScannerConfig(config);
  }
  return res.json({ ok: true, blocked: config.blocklist });
});

// Background auto-scanner (runs alongside scheduler)
let scannerTimer = null;

function startAutoScanner() {
  const config = readScannerConfig();
  if (!config.autoScanEnabled) return;
  const intervalMs = config.autoScanIntervalHours * 60 * 60 * 1000;
  if (scannerTimer) clearInterval(scannerTimer);
  scannerTimer = setInterval(async () => {
    try {
      const cfg = readScannerConfig();
      if (!cfg.autoScanEnabled) { stopAutoScanner(); return; }
      console.log("[scanner] running auto-scan...");
      const results = await scanForFreeModels();
      console.log(`[scanner] found ${results.newCandidates} new candidates out of ${results.totalFreeFound} free models`);

      // Auto-add top candidates if enabled
      if (cfg.autoAddEnabled && results.topRecommendations.length > 0) {
        const pool = readModelPool();
        const existingIds = new Set(pool.models.map((m) => m.id));
        let added = 0;
        for (const rec of results.topRecommendations) {
          if (added >= cfg.maxAutoAdd) break;
          if (existingIds.has(rec.id)) continue;
          if (rec.score < 40) continue; // minimum quality threshold for auto-add

          const capabilities = ["code"];
          if (rec.reasons?.some((r) => r.includes("coding"))) capabilities.push("analysis");
          if (rec.reasons?.some((r) => r.includes("reasoning"))) capabilities.push("planning");
          if (rec.contextLength >= 32000) capabilities.push("analysis");

          pool.models.push({
            id: rec.id,
            provider: "openrouter",
            tier: "free",
            costPer1kTokens: 0,
            dailyLimit: 50,
            usedToday: 0,
            lastResetDate: "",
            enabled: true,
            priority: pool.models.length + 1,
            minTaskPriority: 5,
            maxTaskPriority: 10,
            capabilities: [...new Set(capabilities)],
            addedByScanner: true,
            scanScore: rec.score,
            addedAt: new Date().toISOString(),
          });
          added++;
          console.log(`[scanner] auto-added model: ${rec.id} (score: ${rec.score})`);
        }
        if (added > 0) writeModelPool(pool);
      }
    } catch (err) {
      console.error("[scanner] auto-scan failed:", err.message);
    }
  }, intervalMs);
  console.log(`[scanner] auto-scanner started (every ${config.autoScanIntervalHours}h)`);
}

function stopAutoScanner() {
  if (scannerTimer) { clearInterval(scannerTimer); scannerTimer = null; }
}

// ── Dashboard Auth API ──────────────────────────────────────────────────

app.post("/setup/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: "Username and password required" });
  }
  const user = authenticateUser(username, password);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" });
  }
  const token = createSession(user.id);
  // Update last login
  const data = readUsers();
  const u = data.users.find(uu => uu.id === user.id);
  if (u) { u.lastLoginAt = new Date().toISOString(); writeUsers(data); }

  res.cookie("jclaw_session", token, {
    httpOnly: true,
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  return res.json({
    ok: true,
    user: { id: user.id, username: user.username, role: user.role, displayName: user.displayName },
    token,
  });
});

app.post("/setup/api/auth/logout", (req, res) => {
  const cookieToken = (req.headers.cookie || "").split(";").map(c => c.trim()).find(c => c.startsWith("jclaw_session="));
  const token = cookieToken ? cookieToken.split("=")[1] : null;
  if (token) {
    const data = readUsers();
    data.sessions = (data.sessions || []).filter(s => s.token !== token);
    writeUsers(data);
  }
  res.clearCookie("jclaw_session", { path: "/" });
  return res.json({ ok: true });
});

app.get("/setup/api/auth/me", (req, res) => {
  const cookieToken = (req.headers.cookie || "").split(";").map(c => c.trim()).find(c => c.startsWith("jclaw_session="));
  const token = cookieToken ? cookieToken.split("=")[1] : req.headers["x-dashboard-token"];
  const user = validateSession(token);
  if (!user) {
    // Check Basic auth fallback
    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      const password = idx >= 0 ? decoded.slice(idx + 1) : "";
      if (SETUP_PASSWORD && password === SETUP_PASSWORD) {
        return res.json({ ok: true, user: { id: "basic-auth", username: "owner", role: "owner", displayName: "Owner" }, authMethod: "basic" });
      }
    }
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }
  return res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role, displayName: user.displayName }, authMethod: "session" });
});

app.get("/setup/api/auth/roles", requireSetupAuth, (_req, res) => {
  return res.json({ ok: true, roles: Object.entries(ROLES).map(([id, r]) => ({ id, ...r })) });
});

// User management (admin+)
app.get("/setup/api/users", requireSetupAuth, (_req, res) => {
  const data = readUsers();
  return res.json({
    ok: true,
    users: data.users.map(u => ({
      id: u.id, username: u.username, role: u.role, displayName: u.displayName,
      enabled: u.enabled, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
    })),
  });
});

app.post("/setup/api/users/create", requireSetupAuth, (req, res) => {
  const { username, password, role, displayName } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: "username and password required" });
  if (!ROLES[role]) return res.status(400).json({ ok: false, error: "Invalid role" });
  const data = readUsers();
  if (data.users.find(u => u.username === username)) {
    return res.status(409).json({ ok: false, error: "Username already exists" });
  }
  const newUser = {
    id: crypto.randomUUID(),
    username: username.trim().slice(0, 50),
    passwordHash: crypto.createHash("sha256").update(password).digest("hex"),
    role,
    displayName: (displayName || username).trim().slice(0, 100),
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    enabled: true,
  };
  data.users.push(newUser);
  writeUsers(data);
  return res.json({ ok: true, user: { id: newUser.id, username: newUser.username, role: newUser.role, displayName: newUser.displayName } });
});

app.post("/setup/api/users/update", requireSetupAuth, (req, res) => {
  const { id, role, displayName, enabled, password } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: "User id required" });
  const data = readUsers();
  const user = data.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ ok: false, error: "User not found" });
  if (role && ROLES[role]) user.role = role;
  if (typeof displayName === "string") user.displayName = displayName.trim().slice(0, 100);
  if (typeof enabled === "boolean") user.enabled = enabled;
  if (password) user.passwordHash = crypto.createHash("sha256").update(password).digest("hex");
  writeUsers(data);
  return res.json({ ok: true });
});

app.post("/setup/api/users/delete", requireSetupAuth, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: "User id required" });
  const data = readUsers();
  data.users = data.users.filter(u => u.id !== id);
  data.sessions = (data.sessions || []).filter(s => s.userId !== id);
  writeUsers(data);
  return res.json({ ok: true });
});

// ── BYOK (Bring Your Own Key) Endpoints ─────────────────────────────────

// Get current user's API keys (masked) and quota overrides
app.get("/setup/api/byok/keys", requireDashAuth, (req, res) => {
  const userKeys = getUserApiKeys(req.dashUser.id);
  const masked = {};
  for (const [provider, keyData] of Object.entries(userKeys.keys || {})) {
    masked[provider] = {
      label: keyData.label,
      addedAt: keyData.addedAt,
      masked: keyData.apiKey ? keyData.apiKey.slice(0, 8) + "..." + keyData.apiKey.slice(-4) : "***",
    };
  }
  return res.json({
    ok: true,
    keys: masked,
    quotas: userKeys.quotas,
    providers: Object.entries(BYOK_PROVIDERS).map(([k, v]) => ({ id: k, label: v.label })),
  });
});

// Add or update a BYOK API key
app.post("/setup/api/byok/keys/set", requireDashAuth, (req, res) => {
  const { provider, apiKey, label } = req.body || {};
  if (!provider || !BYOK_PROVIDERS[provider]) {
    return res.status(400).json({ ok: false, error: `Invalid provider. Valid: ${Object.keys(BYOK_PROVIDERS).join(", ")}` });
  }
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
    return res.status(400).json({ ok: false, error: "API key is required (min 10 chars)" });
  }
  setUserApiKey(req.dashUser.id, provider, apiKey.trim(), label);
  appendActivity("byok_key_set", { provider, userId: req.dashUser.id }, req.dashUser);
  return res.json({ ok: true, provider });
});

// Remove a BYOK API key
app.post("/setup/api/byok/keys/remove", requireDashAuth, (req, res) => {
  const { provider } = req.body || {};
  if (!provider) return res.status(400).json({ ok: false, error: "provider required" });
  removeUserApiKey(req.dashUser.id, provider);
  appendActivity("byok_key_removed", { provider, userId: req.dashUser.id }, req.dashUser);
  return res.json({ ok: true });
});

// Set custom quota overrides (BYOK users control their own limits)
app.post("/setup/api/byok/quotas", requireDashAuth, (req, res) => {
  const { paidRequestsPerDay, freeRequestsPerDay, maxConcurrentSessions } = req.body || {};
  const userKeys = getUserApiKeys(req.dashUser.id);
  if (Object.keys(userKeys.keys || {}).length === 0) {
    return res.status(400).json({ ok: false, error: "Add at least one API key before setting custom quotas" });
  }
  const quotas = {
    paidRequestsPerDay: Number.isFinite(paidRequestsPerDay) && paidRequestsPerDay >= 0 ? Math.floor(paidRequestsPerDay) : 50,
    freeRequestsPerDay: freeRequestsPerDay === -1 ? -1 : (Number.isFinite(freeRequestsPerDay) && freeRequestsPerDay >= 0 ? Math.floor(freeRequestsPerDay) : -1),
    maxConcurrentSessions: Number.isFinite(maxConcurrentSessions) && maxConcurrentSessions >= 1 ? Math.min(Math.floor(maxConcurrentSessions), 10) : 5,
  };
  setUserQuotaOverrides(req.dashUser.id, quotas);
  appendActivity("byok_quotas_set", { quotas, userId: req.dashUser.id }, req.dashUser);
  return res.json({ ok: true, quotas });
});

// Owner endpoint: view all users' BYOK keys (masked) and quotas
app.get("/setup/api/byok/all", requireSetupAuth, (_req, res) => {
  const data = readUserApiKeys();
  const result = {};
  for (const [userId, userData] of Object.entries(data.users || {})) {
    const masked = {};
    for (const [provider, keyData] of Object.entries(userData.keys || {})) {
      masked[provider] = {
        label: keyData.label,
        addedAt: keyData.addedAt,
        hasKey: !!keyData.apiKey,
      };
    }
    result[userId] = { keys: masked, quotas: userData.quotas };
  }
  return res.json({ ok: true, users: result });
});

// ── Session Termination ─────────────────────────────────────────────────

app.post("/setup/api/sessions/terminate", requireSetupAuth, async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId required" });
  try {
    const r = await runCmd(OPENCLAW_NODE, clawArgs(["sessions", "delete", sessionId]));
    return res.json({ ok: true, output: r.output });
  } catch (err) {
    // Try kill approach if delete doesn't work
    try {
      await runCmd("sh", ["-c", `pkill -f "session-id.*${sessionId.replace(/[^a-zA-Z0-9_-]/g, "")}" 2>/dev/null || true`]);
      return res.json({ ok: true, output: "Session terminated via process kill" });
    } catch {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
});

// Session detail with messages/history
app.get("/setup/api/sessions/detail", requireSetupAuth, async (req, res) => {
  const { id } = req.query || {};
  if (!id) return res.status(400).json({ ok: false, error: "Session id required" });
  try {
    // Get session info
    const r = await runCmd(OPENCLAW_NODE, clawArgs(["sessions", "--json"]));
    let sessions = [];
    try { sessions = JSON.parse(r.output.trim()); } catch { /* */ }
    if (!Array.isArray(sessions)) sessions = sessions.sessions || sessions.data || [];
    const session = sessions.find(s => s.id === id || s.sessionId === id);

    // Try to get session log
    let messages = [];
    try {
      const logR = await runCmd(OPENCLAW_NODE, clawArgs(["sessions", "log", id, "--json"]), { timeout: 10000 });
      const logOutput = logR.output.trim();
      if (logOutput) {
        try { messages = JSON.parse(logOutput); } catch { /* not parseable */ }
        if (!Array.isArray(messages)) messages = messages.messages || messages.entries || [];
      }
    } catch { /* log command may not exist */ }

    return res.json({
      ok: true,
      session: session || { id, status: "unknown" },
      messages,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Project Management (Create / Clone) ─────────────────────────────────

app.post("/setup/api/projects/create", requireSetupAuth, async (req, res) => {
  const { name, repo, description, template } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: "Project name required" });

  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
  const projectPath = path.join(WORKSPACE_DIR, safeName);

  if (fs.existsSync(projectPath)) {
    return res.status(409).json({ ok: false, error: "Project directory already exists" });
  }

  try {
    if (repo) {
      // Clone existing repo
      const repoUrl = repo.includes("://") ? repo : `https://github.com/${repo}.git`;
      const r = await runCmd("git", ["clone", repoUrl, projectPath], { timeout: 60000 });
      return res.json({ ok: true, path: projectPath, output: r.output, method: "clone" });
    } else {
      // Create new project
      fs.mkdirSync(projectPath, { recursive: true });
      fs.writeFileSync(path.join(projectPath, "README.md"), `# ${name}\n\n${description || ""}\n`);
      await runCmd("git", ["init"], { cwd: projectPath });
      await runCmd("git", ["add", "."], { cwd: projectPath });
      await runCmd("git", ["commit", "-m", "Initial commit"], { cwd: projectPath });

      // Apply template scaffolding if provided
      if (template === "node") {
        fs.writeFileSync(path.join(projectPath, "package.json"), JSON.stringify({ name: safeName, version: "1.0.0", description: description || "", main: "index.js", scripts: { start: "node index.js", test: "echo \"no tests\"" } }, null, 2));
        fs.writeFileSync(path.join(projectPath, "index.js"), "// TODO: Implement\nconsole.log('Hello from " + safeName + "');\n");
      } else if (template === "python") {
        fs.writeFileSync(path.join(projectPath, "main.py"), "# TODO: Implement\nprint('Hello from " + safeName + "')\n");
        fs.writeFileSync(path.join(projectPath, "requirements.txt"), "");
      }

      return res.json({ ok: true, path: projectPath, method: "create" });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// AI project idea generation (SSE streaming to reduce perceived latency)
app.post("/setup/api/projects/ideas", requireSetupAuth, (req, res) => {
  const { context, stream } = req.body || {};

  if (stream) {
    // SSE streaming mode - send chunks as they arrive
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    function sendSSE(event, data) {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
    }

    (async () => {
      try {
        const projectsR = await runCmd("sh", ["-c", `ls -1 "${WORKSPACE_DIR}" 2>/dev/null | head -20`]);
        const existingProjects = projectsR.output.trim();
        const prompt = `Based on the existing projects: ${existingProjects}. ${context || "Suggest 5 innovative project ideas that complement the existing portfolio. Include: AI/ML projects, web applications, automation tools, and data analysis projects."} Format as JSON array with fields: name, description, template (node/python/other), category, difficulty (easy/medium/hard).`;

        sendSSE("status", { status: "generating" });
        const proc = childProcess.spawn(OPENCLAW_NODE, clawArgs(["agent", "--session-id", "project-ideas", "--message", prompt, "--timeout", "60"]), {
          env: { ...process.env, OPENCLAW_STATE_DIR: STATE_DIR, OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR },
        });

        let fullOutput = "";
        proc.stdout?.on("data", (d) => { const t = d.toString("utf8"); fullOutput += t; sendSSE("chunk", { text: t }); });
        proc.stderr?.on("data", (d) => { const t = d.toString("utf8"); fullOutput += t; });
        proc.on("close", (code) => {
          let ideas = [];
          const jsonMatch = fullOutput.match(/\[[\s\S]*?\]/);
          if (jsonMatch) { try { ideas = JSON.parse(jsonMatch[0]); } catch { /* */ } }
          sendSSE("done", { ideas, raw: fullOutput.slice(0, 5000) });
          try { res.end(); } catch { /* closed */ }
        });
        proc.on("error", (err) => { sendSSE("error", { message: err.message }); try { res.end(); } catch { /* */ } });
        req.on("close", () => { try { proc.kill("SIGTERM"); } catch { /* */ } });
      } catch (err) {
        sendSSE("error", { message: err.message });
        try { res.end(); } catch { /* */ }
      }
    })();
    return;
  }

  // Non-streaming fallback
  (async () => {
    try {
      const projectsR = await runCmd("sh", ["-c", `ls -1 "${WORKSPACE_DIR}" 2>/dev/null | head -20`]);
      const existingProjects = projectsR.output.trim();
      const prompt = `Based on the existing projects: ${existingProjects}. ${context || "Suggest 5 innovative project ideas that complement the existing portfolio. Include: AI/ML projects, web applications, automation tools, and data analysis projects."} Format as JSON array with fields: name, description, template (node/python/other), category, difficulty (easy/medium/hard).`;
      const r = await runCmd(OPENCLAW_NODE, clawArgs(["agent", "--session-id", "project-ideas", "--message", prompt, "--timeout", "60"]), { timeout: 70000 });
      let ideas = [];
      const output = r.output || "";
      const jsonMatch = output.match(/\[[\s\S]*?\]/);
      if (jsonMatch) { try { ideas = JSON.parse(jsonMatch[0]); } catch { /* */ } }
      return res.json({ ok: true, ideas, raw: output.slice(0, 5000) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  })();
});

// ── Project Detail & Actions ────────────────────────────────────────────

app.get("/setup/api/projects/:name", requireSetupAuth, async (req, res) => {
  const projName = req.params.name.replace(/[^a-zA-Z0-9_.-]/g, "");
  const projDir = path.join(WORKSPACE_DIR, projName);
  if (!fs.existsSync(projDir)) return res.status(404).json({ ok: false, error: "Project not found" });

  try {
    const [branch, log, status, remotes, readme] = await Promise.all([
      runCmd("git", ["-C", projDir, "branch", "--show-current"]),
      runCmd("git", ["-C", projDir, "log", "--oneline", "--pretty=format:%h\x1f%s\x1f%an\x1f%ar", "-20"]),
      runCmd("git", ["-C", projDir, "status", "--short"]),
      runCmd("git", ["-C", projDir, "remote", "-v"]),
      new Promise(resolve => {
        try { resolve(fs.readFileSync(path.join(projDir, "README.md"), "utf8").slice(0, 3000)); }
        catch { resolve(""); }
      }),
    ]);

    // List top-level files
    let files = [];
    try {
      files = fs.readdirSync(projDir, { withFileTypes: true })
        .filter(e => !e.name.startsWith(".git") || e.name === ".gitignore")
        .map(e => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }))
        .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);
    } catch { /* skip */ }

    // Parse commits (using unit separator \x1f to avoid conflicts with pipe in commit messages)
    const commits = (log.output || "").split("\n").filter(Boolean).map(line => {
      const [hash, message, author, time] = line.split("\x1f");
      return { hash, message, author, time };
    });

    // Get branches
    let branches = [];
    try {
      const branchR = await runCmd("git", ["-C", projDir, "branch", "-a", "--no-color"]);
      branches = (branchR.output || "").split("\n").map(b => b.trim().replace(/^\* /, "")).filter(Boolean);
    } catch { /* skip */ }

    return res.json({
      ok: true,
      name: projName,
      branch: (branch.output || "").trim(),
      commits,
      dirty: (status.output || "").trim().split("\n").filter(Boolean),
      remotes: (remotes.output || "").trim(),
      branches,
      files,
      readme,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/setup/api/projects/:name/action", requireSetupAuth, async (req, res) => {
  const projName = req.params.name.replace(/[^a-zA-Z0-9_.-]/g, "");
  const projDir = path.join(WORKSPACE_DIR, projName);
  if (!fs.existsSync(projDir)) return res.status(404).json({ ok: false, error: "Project not found" });

  const { action, branch, message } = req.body || {};
  if (!action) return res.status(400).json({ ok: false, error: "Action required" });

  try {
    let result;
    switch (action) {
      case "pull":
        result = await runCmd("git", ["-C", projDir, "pull", "--ff-only"], { timeout: 30000 });
        break;
      case "fetch":
        result = await runCmd("git", ["-C", projDir, "fetch", "--all"], { timeout: 30000 });
        break;
      case "checkout":
        if (!branch) return res.status(400).json({ ok: false, error: "Branch required for checkout" });
        result = await runCmd("git", ["-C", projDir, "checkout", branch.replace(/[^a-zA-Z0-9/_.-]/g, "")]);
        break;
      case "diff":
        result = await runCmd("git", ["-C", projDir, "diff", "--stat"]);
        break;
      case "log":
        result = await runCmd("git", ["-C", projDir, "log", "--oneline", "-30"]);
        break;
      case "stash":
        result = await runCmd("git", ["-C", projDir, "stash"]);
        break;
      case "stash-pop":
        result = await runCmd("git", ["-C", projDir, "stash", "pop"]);
        break;
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
    appendActivity("project_action", { project: projName, action, exit: result.code }, req.dashUser);
    return res.json({ ok: true, output: (result.output || "").slice(0, 5000), code: result.code });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Browse project files
app.get("/setup/api/projects/:name/file", requireSetupAuth, (req, res) => {
  const projName = req.params.name.replace(/[^a-zA-Z0-9_.-]/g, "");
  const filePath = req.query.path || "";
  const projectBase = path.resolve(path.join(WORKSPACE_DIR, projName)) + path.sep;
  const fullPath = path.resolve(path.join(WORKSPACE_DIR, projName, filePath));
  // Ensure path is within project (trailing separator prevents prefix collisions like proj vs proj-evil)
  if (!fullPath.startsWith(projectBase) && fullPath !== projectBase.slice(0, -1)) {
    return res.status(403).json({ ok: false, error: "Path traversal blocked" });
  }
  if (!fs.existsSync(fullPath)) return res.status(404).json({ ok: false, error: "Not found" });

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      .filter(e => !e.name.startsWith(".git") || e.name === ".gitignore")
      .map(e => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }))
      .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);
    return res.json({ ok: true, type: "dir", entries, path: filePath });
  }
  // Read file (limit 100KB)
  if (stat.size > 100 * 1024) return res.json({ ok: true, type: "file", content: "(file too large)", path: filePath, size: stat.size });
  const content = fs.readFileSync(fullPath, "utf8");
  return res.json({ ok: true, type: "file", content, path: filePath, size: stat.size });
});

// ── GitHub Webhook (auto-sync on push) ──────────────────────────────────

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET?.trim() || "";

app.post("/webhooks/github", async (req, res) => {
  // Require webhook secret in production to prevent unauthenticated git pulls
  if (!WEBHOOK_SECRET) {
    return res.status(503).json({ ok: false, error: "GITHUB_WEBHOOK_SECRET not configured" });
  }

  // Verify webhook signature (body is already parsed by express.json())
  const sig = req.headers["x-hub-signature-256"] || "";
  if (!sig) {
    return res.status(401).json({ ok: false, error: "Missing signature header" });
  }
  // Reconstruct the body as GitHub would have sent it
  const rawBody = JSON.stringify(req.body);
  const expected = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return res.status(401).json({ ok: false, error: "Invalid signature" });
  }

  const event = req.headers["x-github-event"];
  const payload = req.body;

  if (event === "push") {
    const repo = payload.repository?.full_name;
    const branch = (payload.ref || "").replace("refs/heads/", "");
    const projName = repo ? repo.split("/").pop() : null;

    if (projName) {
      const projDir = path.join(WORKSPACE_DIR, projName);
      if (fs.existsSync(projDir)) {
        appendActivity("webhook_push", { repo, branch, commits: (payload.commits || []).length });
        // Auto-pull if on the same branch
        try {
          const currentBranch = await runCmd("git", ["-C", projDir, "branch", "--show-current"]);
          if (currentBranch.output.trim() === branch) {
            const pullR = await runCmd("git", ["-C", projDir, "pull", "--ff-only"], { timeout: 30000 });
            appendActivity("webhook_auto_sync", { repo, branch, result: pullR.code === 0 ? "success" : "failed" });
            broadcastSSE("project_updated", { project: projName, branch, action: "auto-sync" });
          }
        } catch (err) {
          console.warn("[webhook] auto-pull failed:", err.message);
        }
      }
    }
  }

  return res.json({ ok: true, event });
});

// ── Health Monitoring ───────────────────────────────────────────────────

let healthCheckTimer = null;
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function performHealthCheck() {
  const checks = {
    gateway: isGatewayReady(),
    configured: isConfigured(),
    memoryMB: Math.floor(process.memoryUsage().rss / 1024 / 1024),
    uptime: Math.floor(process.uptime()),
    diskUsage: null,
  };

  // Check disk usage
  try {
    const df = await runCmd("sh", ["-c", "df -h /data 2>/dev/null | tail -1 | awk '{print $5}'"]);
    checks.diskUsage = df.output.trim();
  } catch { /* skip */ }

  // Alert if gateway is down
  if (!checks.gateway && isConfigured()) {
    appendActivity("gateway_error", { status: "down", memory: checks.memoryMB });
  }

  // Alert on high memory (>512MB)
  if (checks.memoryMB > 512) {
    appendActivity("high_memory", { memoryMB: checks.memoryMB });
  }

  // Alert on high disk usage
  if (checks.diskUsage) {
    const pct = parseInt(checks.diskUsage);
    if (pct > 90) {
      appendActivity("high_disk_usage", { usage: checks.diskUsage });
    }
  }

  // Broadcast health status to SSE clients
  broadcastSSE("health", checks);
  return checks;
}

function startHealthMonitor() {
  if (healthCheckTimer) return;
  healthCheckTimer = setInterval(performHealthCheck, HEALTH_CHECK_INTERVAL);
  // Run initial check after 30s
  setTimeout(performHealthCheck, 30000);
}

function stopHealthMonitor() {
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
}

app.get("/setup/api/health/check", requireSetupAuth, async (_req, res) => {
  const checks = await performHealthCheck();
  return res.json({ ok: true, ...checks });
});

// ── Tools Management ────────────────────────────────────────────────────

app.get("/setup/api/tools/list", requireSetupAuth, async (_req, res) => {
  const tools = [
    { id: "gh", name: "GitHub CLI", checkCmd: "gh --version 2>&1 | head -1", category: "devops" },
    { id: "git", name: "Git", checkCmd: "git --version 2>&1", category: "devops" },
    { id: "node", name: "Node.js", checkCmd: "node --version 2>&1", category: "runtime" },
    { id: "npm", name: "npm", checkCmd: "npm --version 2>&1", category: "runtime" },
    { id: "jq", name: "jq", checkCmd: "jq --version 2>&1", category: "utility" },
    { id: "wrangler", name: "Wrangler (Cloudflare)", checkCmd: "wrangler --version 2>&1 | head -1", category: "deploy" },
    { id: "railway", name: "Railway CLI", checkCmd: "railway --version 2>&1 | head -1", category: "deploy" },
    { id: "clawhub", name: "ClawHub CLI", checkCmd: "clawhub --version 2>&1 | head -1", category: "openclaw" },
    { id: "python3", name: "Python 3", checkCmd: "python3 --version 2>&1", category: "runtime" },
    { id: "curl", name: "curl", checkCmd: "curl --version 2>&1 | head -1", category: "utility" },
    { id: "docker", name: "Docker", checkCmd: "docker --version 2>&1", category: "devops" },
  ];

  const results = await Promise.allSettled(
    tools.map(async (tool) => {
      try {
        const r = await runCmd("sh", ["-c", tool.checkCmd], { timeout: 5000 });
        return { ...tool, installed: r.code === 0, version: r.output.trim().slice(0, 200) };
      } catch {
        return { ...tool, installed: false, version: null };
      }
    })
  );

  const envVars = ["GH_PAT", "OPENAI_API_KEY", "OPENROUTER_API_TOKEN", "ANTHROPIC_API_KEY", "CLOUDFLARE_ACCOUNT_ID",
    "RAILWAY_ACCOUNT_TOKEN", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_ID",
    "TELEGRAM_API_ID", "TELEGRAM_API_HASH", "GROK_API_KEY",
    "SETUP_PASSWORD", "OPENCLAW_GATEWAY_TOKEN"];
  const envStatus = envVars.map(v => ({ name: v, set: !!process.env[v] }));

  return res.json({
    ok: true,
    tools: results.map(r => r.status === "fulfilled" ? r.value : r.reason),
    envVars: envStatus,
  });
});

app.post("/setup/api/tools/install", requireSetupAuth, async (req, res) => {
  const { tool } = req.body || {};
  if (!tool) return res.status(400).json({ ok: false, error: "Tool name required" });

  // Supported tool installations
  const installCmds = {
    "gh": "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && apt-get update && apt-get install gh -y",
    "jq": "apt-get update && apt-get install -y jq",
    "python3": "apt-get update && apt-get install -y python3 python3-pip",
    "curl": "apt-get update && apt-get install -y curl",
    "clawhub": "npm install -g clawhub@latest",
    "wrangler": "npm install -g wrangler@latest",
  };

  if (!installCmds[tool]) {
    return res.status(400).json({ ok: false, error: `No install recipe for: ${tool}. Install it manually via the shell.` });
  }

  try {
    const r = await runCmd("sh", ["-c", installCmds[tool]], { timeout: 120000 });
    return res.json({ ok: true, output: r.output.slice(-2000), code: r.code });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/setup/api/tools/set-env", requireSetupAuth, async (req, res) => {
  const { name, value } = req.body || {};
  if (!name || typeof name !== "string") return res.status(400).json({ ok: false, error: "Variable name required" });
  // Set in current process
  if (value) {
    process.env[name] = value;
  } else {
    delete process.env[name];
  }
  return res.json({ ok: true, note: "Set in current process. For persistence across deploys, set via Railway env vars." });
});

// ── Railway GraphQL API Integration ─────────────────────────────────────

const RAILWAY_GQL = "https://backboard.railway.com/graphql/v2";

function getRailwayIds() {
  const projectId = process.env.RAILWAY_PROJECT_ID;
  const serviceId = process.env.RAILWAY_SERVICE_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!projectId || !serviceId || !environmentId) {
    throw new Error("Missing Railway IDs: set RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID, and RAILWAY_ENVIRONMENT_ID");
  }
  return { projectId, serviceId, environmentId };
}

async function railwayGql(query, variables = {}) {
  const token = process.env.RAILWAY_ACCOUNT_TOKEN;
  if (!token) throw new Error("RAILWAY_ACCOUNT_TOKEN not set");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(RAILWAY_GQL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) throw new Error(`Railway API ${r.status}: ${await r.text()}`);
    const json = await r.json();
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    return json.data;
  } finally {
    clearTimeout(timeout);
  }
}

// Railway Metrics (CPU, memory, network, disk)
app.get("/setup/api/railway/metrics", requireSetupAuth, async (req, res) => {
  try {
    const { environmentId, serviceId } = getRailwayIds();
    let hours = Number(req.query?.hours);
    if (!Number.isFinite(hours)) hours = 6;
    hours = Math.min(Math.max(Math.trunc(hours), 1), 168); // clamp 1-168 hours
    const startDate = new Date(Date.now() - hours * 3600_000).toISOString();
    const measurements = ["CPU_USAGE", "CPU_LIMIT", "MEMORY_USAGE_GB", "MEMORY_LIMIT_GB", "NETWORK_RX_GB", "NETWORK_TX_GB", "DISK_USAGE_GB"];
    const data = await railwayGql(
      `query($envId: String!, $svcId: String, $startDate: DateTime!, $measurements: [MetricMeasurement!]!) {
        metrics(environmentId: $envId, serviceId: $svcId, startDate: $startDate, measurements: $measurements) {
          measurement
          tags { serviceId deploymentId }
          values { ts value }
        }
      }`,
      { envId: environmentId, svcId: serviceId, startDate, measurements },
    );
    // Summarise latest values for each measurement
    const summary = {};
    for (const m of data.metrics || []) {
      const vals = m.values || [];
      const latest = vals.length ? vals[vals.length - 1] : null;
      summary[m.measurement] = { latest: latest?.value ?? null, latestTs: latest?.ts ?? null, dataPoints: vals.length };
    }
    return res.json({ ok: true, hours, summary, raw: data.metrics });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// Railway Deployment Status & History
app.get("/setup/api/railway/deployments", requireSetupAuth, async (req, res) => {
  try {
    const { projectId, serviceId, environmentId } = getRailwayIds();
    let limit = Number(req.query?.limit);
    if (!Number.isFinite(limit)) limit = 10;
    limit = Math.min(Math.max(Math.trunc(limit), 1), 50); // clamp 1-50
    const data = await railwayGql(
      `query($projectId: String!, $envId: String!, $svcId: String!) {
        deployments(first: ${limit}, input: { projectId: $projectId, environmentId: $envId, serviceId: $svcId }) {
          edges {
            node {
              id status createdAt updatedAt
              staticUrl
              meta
              canRollback
            }
          }
        }
      }`,
      { projectId, envId: environmentId, svcId: serviceId },
    );
    const deployments = (data.deployments?.edges || []).map((e) => e.node);
    return res.json({ ok: true, deployments });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// Railway Redeploy / Restart / Rollback
app.post("/setup/api/railway/deploy-action", requireSetupAuth, async (req, res) => {
  const { action, deploymentId } = req.body || {};
  if (!action || !["redeploy", "restart", "rollback", "cancel"].includes(action)) {
    return res.status(400).json({ ok: false, error: "action must be: redeploy, restart, rollback, or cancel" });
  }
  if (!deploymentId || typeof deploymentId !== "string") {
    return res.status(400).json({ ok: false, error: "deploymentId required" });
  }
  const mutations = {
    redeploy: `mutation($id: String!) { deploymentRedeploy(id: $id) }`,
    restart: `mutation($id: String!) { deploymentRestart(id: $id) }`,
    rollback: `mutation($id: String!) { deploymentRollback(id: $id) }`,
    cancel: `mutation($id: String!) { deploymentCancel(id: $id) }`,
  };
  try {
    const data = await railwayGql(mutations[action], { id: deploymentId });
    appendActivity("railway_deploy_action", { action, deploymentId });
    return res.json({ ok: true, action, data });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// Railway Build & Runtime Logs
app.get("/setup/api/railway/logs", requireSetupAuth, async (req, res) => {
  try {
    const { projectId, serviceId, environmentId } = getRailwayIds();
    const deploymentId = req.query?.deploymentId;
    const type = req.query?.type || "runtime"; // "build" or "runtime"
    let limit = Number(req.query?.limit);
    if (!Number.isFinite(limit)) limit = 200;
    limit = Math.min(Math.max(Math.trunc(limit), 1), 1000); // clamp 1-1000
    if (!deploymentId) {
      // Get latest deployment ID automatically
      const depData = await railwayGql(
        `query($projectId: String!, $envId: String!, $svcId: String!) {
          deployments(first: 5, input: { projectId: $projectId, environmentId: $envId, serviceId: $svcId }) {
            edges { node { id status } }
          }
        }`,
        { projectId, envId: environmentId, svcId: serviceId },
      );
      // Pick the first deployment with a loggable status
      const edges = depData.deployments?.edges || [];
      const latest = edges.map((e) => e.node).find((n) => ["SUCCESS", "DEPLOYING", "CRASHED", "FAILED"].includes(n.status)) || edges[0]?.node;
      if (!latest) return res.status(404).json({ ok: false, error: "No deployments found" });
      req.query.deploymentId = latest.id;
    }
    const depId = req.query.deploymentId;
    const validType = type === "build" ? "build" : "runtime";
    const queryName = validType === "build" ? "buildLogs" : "deploymentLogs";
    const data = await railwayGql(
      `query($deploymentId: String!, $limit: Int) { ${queryName}(deploymentId: $deploymentId, limit: $limit) { message timestamp severity } }`,
      { deploymentId: depId, limit },
    );
    const logs = data[queryName] || [];
    return res.json({ ok: true, type: validType, deploymentId: depId, logs });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// Railway Volume Backup Management
app.get("/setup/api/railway/volume", requireSetupAuth, async (req, res) => {
  try {
    const { projectId } = getRailwayIds();
    const data = await railwayGql(
      `query($projectId: String!) {
        project(id: $projectId) {
          volumes { edges { node { id name createdAt } } }
        }
      }`,
      { projectId },
    );
    const volumes = (data.project?.volumes?.edges || []).map((e) => e.node);
    // Fetch volume instance details if we have a volume
    let volumeInstance = null;
    if (volumes.length > 0) {
      try {
        // Use the shell to find volume instance ID from Railway env
        const viId = process.env.RAILWAY_VOLUME_INSTANCE_ID;
        if (viId) {
          const viData = await railwayGql(
            `query($id: String!) { volumeInstance(id: $id) { id mountPath currentSizeMB state environmentId serviceId } }`,
            { id: viId },
          );
          volumeInstance = viData.volumeInstance;
        }
      } catch { /* volume instance query failed, continue without */ }
    }
    // Local disk usage from the volume mount path
    const mountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH || "/data";
    let diskInfo = null;
    const df = await runCmd("sh", ["-c", `df -BM ${mountPath} 2>/dev/null | tail -1 | awk '{print $2,$3,$4,$5}'`]);
    if (df.code === 0 && df.output.trim()) {
      const parts = df.output.trim().split(/\s+/);
      if (parts.length >= 4) {
        diskInfo = {
          totalMB: parseInt(parts[0], 10) || 0,
          usedMB: parseInt(parts[1], 10) || 0,
          availMB: parseInt(parts[2], 10) || 0,
          usePct: parts[3],
          mountPath,
        };
      }
    }
    return res.json({ ok: true, volumes, volumeInstance, disk: diskInfo });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

app.post("/setup/api/railway/volume/backup", requireSetupAuth, async (req, res) => {
  const { volumeInstanceId } = req.body || {};
  if (!volumeInstanceId) return res.status(400).json({ ok: false, error: "volumeInstanceId required" });
  try {
    const data = await railwayGql(
      `mutation($id: String!) { volumeInstanceBackupCreate(volumeInstanceId: $id) { workflowId } }`,
      { id: volumeInstanceId },
    );
    appendActivity("railway_volume_backup", { volumeInstanceId, action: "create" });
    return res.json({ ok: true, workflowId: data.volumeInstanceBackupCreate?.workflowId });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

app.get("/setup/api/railway/volume/backups", requireSetupAuth, async (req, res) => {
  const volumeInstanceId = req.query?.volumeInstanceId;
  if (!volumeInstanceId) return res.status(400).json({ ok: false, error: "volumeInstanceId query param required" });
  try {
    const data = await railwayGql(
      `query($id: String!) { volumeInstanceBackupList(volumeInstanceId: $id) { id name createdAt usedMB referencedMB volumeInstanceSizeMB expiresAt } }`,
      { id: volumeInstanceId },
    );
    return res.json({ ok: true, backups: data.volumeInstanceBackupList || [] });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

app.post("/setup/api/railway/volume/restore", requireSetupAuth, async (req, res) => {
  const { backupId, volumeInstanceId } = req.body || {};
  if (!backupId || !volumeInstanceId) return res.status(400).json({ ok: false, error: "backupId and volumeInstanceId required" });
  try {
    const data = await railwayGql(
      `mutation($volumeInstanceBackupId: String!, $volumeInstanceId: String!) { volumeInstanceBackupRestore(volumeInstanceBackupId: $volumeInstanceBackupId, volumeInstanceId: $volumeInstanceId) }`,
      { volumeInstanceBackupId: backupId, volumeInstanceId },
    );
    appendActivity("railway_volume_backup", { backupId, volumeInstanceId, action: "restore" });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// Railway Batch Environment Variable Setter (uses variableCollectionUpsert for atomic batch)
app.post("/setup/api/railway/env", requireSetupAuth, async (req, res) => {
  const { variables, skipDeploys } = req.body || {};
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
    return res.status(400).json({ ok: false, error: "variables must be an object of { name: value } pairs" });
  }
  try {
    const { projectId, serviceId, environmentId } = getRailwayIds();
    const shouldSkipDeploys = skipDeploys !== false; // default true to avoid triggering redeploys
    // Build clean variables object
    const cleanVars = {};
    for (const [name, value] of Object.entries(variables)) {
      if (typeof name === "string" && name.trim()) cleanVars[name.trim()] = String(value);
    }
    if (Object.keys(cleanVars).length === 0) {
      return res.status(400).json({ ok: false, error: "No valid variables provided" });
    }
    await railwayGql(
      `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
      {
        input: {
          projectId,
          environmentId,
          serviceId,
          variables: cleanVars,
          replace: false,
        },
      },
    );
    const varNames = Object.keys(cleanVars);
    // Trigger redeploy when user explicitly sets skipDeploys to false
    if (!shouldSkipDeploys) {
      try {
        await railwayGql(
          `mutation($svcId: String!, $envId: String!) { serviceInstanceRedeploy(serviceId: $svcId, environmentId: $envId) }`,
          { svcId: serviceId, envId: environmentId },
        );
      } catch { /* redeploy best-effort */ }
    }
    appendActivity("railway_env_set", { count: varNames.length, variables: varNames, skipDeploys: shouldSkipDeploys });
    return res.json({ ok: true, set: varNames, skipDeploys: shouldSkipDeploys, note: shouldSkipDeploys ? "Variables set without triggering redeploy. Redeploy manually when ready." : "Variables set. Redeploy triggered." });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// Railway Service Info (replicas, health, config)
app.get("/setup/api/railway/service", requireSetupAuth, async (_req, res) => {
  try {
    const { projectId } = getRailwayIds();
    const data = await railwayGql(
      `query($projectId: String!) {
        project(id: $projectId) {
          id name description
          services {
            edges {
              node {
                id name icon
                serviceInstances {
                  edges {
                    node {
                      environmentId
                      startCommand buildCommand
                      healthcheckPath healthcheckTimeout
                      numReplicas
                      domains { serviceDomains { domain } customDomains { domain } }
                    }
                  }
                }
              }
            }
          }
          environments {
            edges { node { id name } }
          }
        }
      }`,
      { projectId },
    );
    return res.json({ ok: true, project: data.project });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// ── Activity Log API ────────────────────────────────────────────────────

app.get("/setup/api/activity", requireSetupAuth, (req, res) => {
  const limit = Math.min(Number(req.query?.limit) || 100, 2000);
  const { user, type, from, to, search } = req.query || {};
  const entries = filterActivityLog({ limit, user, type, from, to, search });
  // Compute type summary for filter UI
  const typeCounts = {};
  for (const e of entries) { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; }
  return res.json({ ok: true, entries, typeCounts, total: entries.length });
});

// Alert config management
app.get("/setup/api/alerts/config", requireSetupAuth, (_req, res) => {
  return res.json({ ok: true, config: readAlertConfig() });
});

app.post("/setup/api/alerts/config", requireDashAuth, (req, res) => {
  const config = readAlertConfig();
  const { telegram, rules, cooldownMinutes } = req.body || {};
  if (telegram && typeof telegram === "object") {
    if (typeof telegram.enabled === "boolean") config.telegram.enabled = telegram.enabled;
    if (typeof telegram.botToken === "string") config.telegram.botToken = telegram.botToken.trim();
    if (typeof telegram.chatId === "string") config.telegram.chatId = telegram.chatId.trim();
  }
  if (Array.isArray(rules)) {
    config.rules = rules.filter(r => r.id && r.type).slice(0, 20);
  }
  if (typeof cooldownMinutes === "number" && cooldownMinutes >= 1) config.cooldownMinutes = cooldownMinutes;
  writeAlertConfig(config);
  appendActivity("alerts_config_updated", {}, req.dashUser);
  return res.json({ ok: true, config });
});

app.post("/setup/api/alerts/test", requireDashAuth, async (req, res) => {
  await sendTelegramAlert("🧪 *Test Alert* from JClaw Dashboard\nIf you see this, alerts are working!");
  return res.json({ ok: true });
});

// User quota info
app.get("/setup/api/quota", requireDashAuth, (req, res) => {
  const user = req.dashUser;
  const quotas = ROLE_MODEL_QUOTAS[user.role] || ROLE_MODEL_QUOTAS["limited-read"];
  const usage = getUserUsageToday(user.id);
  return res.json({
    ok: true,
    quotas,
    usage,
    activeSessions: getUserSessionCount(user.id),
  });
});

// All users' usage (owner only)
app.get("/setup/api/usage", requireDashAuth, (req, res) => {
  if (req.dashUser.role !== "owner") return res.status(403).json({ ok: false, error: "Owner only" });
  const usage = readUserUsage();
  return res.json({ ok: true, ...usage });
});

// Real-time SSE event stream
app.get("/setup/api/events", requireDashAuth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("event: connected\ndata: {}\n\n");
  sseClients.add(res);
  req.on("close", () => { sseClients.delete(res); });
});

// ── Runner: Edit task ───────────────────────────────────────────────────

app.post("/setup/api/runner/edit", requireDashAuth, (req, res) => {
  const { id, title, description, priority, project } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing required field: id" });
  }
  const queue = readTaskQueue();
  const task = queue.tasks.find((t) => t.id === id);
  if (!task) {
    return res.status(404).json({ ok: false, error: "Task not found" });
  }
  if (typeof title === "string" && title.trim()) task.title = title.slice(0, 500);
  if (typeof description === "string") task.description = description.slice(0, 5000);
  if (typeof project === "string") task.project = project.slice(0, 200);
  if (Number.isInteger(priority) && priority >= 1 && priority <= 10) task.priority = priority;
  writeTaskQueue(queue);
  return res.json({ ok: true, task });
});

// ── Runner: Execute a task now ──────────────────────────────────────────

app.post("/setup/api/runner/run", requireDashAuth, async (req, res) => {
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing required field: id" });
  }
  const queue = readTaskQueue();
  const task = queue.tasks.find((t) => t.id === id);
  if (!task) {
    return res.status(404).json({ ok: false, error: "Task not found" });
  }
  if (task.status === "running") {
    return res.status(409).json({ ok: false, error: "Task is already running" });
  }

  task.status = "running";
  task.startedAt = new Date().toISOString();
  writeTaskQueue(queue);
  appendActivity("task_started", { id: task.id, title: task.title, project: task.project });

  // Run asynchronously so the HTTP response returns immediately
  const engineCfg = queue.config.engines?.openclaw || {};
  const timeout = engineCfg.timeout || 180;
  const projectPath = task.project ? task.project.split("/").pop() : "";
  const prompt = [
    task.title,
    task.description ? `\nDetails: ${task.description}` : "",
    projectPath ? `\nWork in the ${projectPath} project directory.` : "",
  ].join("");

  const agentArgs = [
    "agent", "--session-id", `runner-${task.id.slice(0, 8)}`,
    "--message", prompt,
    "--timeout", String(timeout),
  ];

  runCmd(OPENCLAW_NODE, clawArgs(agentArgs)).then((r) => {
    const q2 = readTaskQueue();
    const t2 = q2.tasks.find((t) => t.id === id);
    if (t2) {
      t2.status = r.code === 0 ? "completed" : "failed";
      t2.completedAt = new Date().toISOString();
      t2.result = (r.output || "").slice(-2000);
      // Move to history
      q2.tasks = q2.tasks.filter((t) => t.id !== id);
      q2.history.push(t2);
      if (q2.history.length > 500) q2.history = q2.history.slice(-500);
      writeTaskQueue(q2);
      appendActivity("task_completed", {
        id: t2.id, title: t2.title, project: t2.project,
        status: t2.status, exit: r.code,
      });
    }
  }).catch((err) => {
    const q2 = readTaskQueue();
    const t2 = q2.tasks.find((t) => t.id === id);
    if (t2) {
      t2.status = "failed";
      t2.completedAt = new Date().toISOString();
      t2.result = err.message;
      q2.tasks = q2.tasks.filter((t) => t.id !== id);
      q2.history.push(t2);
      if (q2.history.length > 500) q2.history = q2.history.slice(-500);
      writeTaskQueue(q2);
      appendActivity("task_failed", { id: t2.id, title: t2.title, error: err.message });
    }
  });

  return res.json({ ok: true, message: "Task execution started", task });
});

// ── AI-Suggested Tasks ──────────────────────────────────────────────────

// Gather project context for suggestions
async function gatherProjectContext(targetProject) {
  let projects = [];
  try {
    const entries = fs.readdirSync(WORKSPACE_DIR, { withFileTypes: true });
    projects = entries.filter(e => e.isDirectory() && !e.name.startsWith(".")).map(e => e.name);
  } catch { projects = []; }

  const targetProjects = targetProject
    ? projects.filter(p => p === targetProject || p === targetProject.split("/").pop())
    : projects;

  const projectData = [];
  for (const proj of targetProjects.slice(0, 6)) {
    const projDir = path.join(WORKSPACE_DIR, proj);
    try { if (!fs.statSync(projDir).isDirectory()) continue; } catch { continue; }
    const info = { name: proj, commits: [], dirtyFiles: [], issues: [], claudeMd: "" };

    try {
      info.claudeMd = fs.readFileSync(path.join(projDir, "CLAUDE.md"), "utf8").slice(0, 500);
    } catch { /* skip */ }

    const gitLog = await runCmd("git", ["-C", projDir, "log", "--oneline", "-10"]);
    if (gitLog.code === 0) info.commits = gitLog.output.trim().split("\n").filter(Boolean);

    const gitSt = await runCmd("git", ["-C", projDir, "status", "--short"]);
    if (gitSt.code === 0 && gitSt.output.trim()) info.dirtyFiles = gitSt.output.trim().split("\n").filter(Boolean);

    try {
      const issues = await runCmd("gh", ["issue", "list", "-R", `JW-Flo/${proj}`, "--limit", "5", "--json", "title,number,labels"], { cwd: projDir });
      if (issues.code === 0 && issues.output.trim()) {
        try { info.issues = JSON.parse(issues.output); } catch { /* skip */ }
      }
    } catch { /* gh not available */ }

    projectData.push(info);
  }
  return projectData;
}

// Generate context-based suggestions without AI (fast fallback)
function generateContextSuggestions(projectData, history) {
  const suggestions = [];
  const recentTitles = new Set(history.slice(-20).map(t => t.title.toLowerCase()));

  for (const proj of projectData) {
    // Suggest from open issues
    for (const issue of (proj.issues || []).slice(0, 2)) {
      const title = `Fix #${issue.number}: ${issue.title}`;
      if (!recentTitles.has(title.toLowerCase())) {
        const labels = (issue.labels || []).map(l => l.name || l).join(", ");
        suggestions.push({
          title,
          description: `Address open issue in ${proj.name}. ${labels ? "Labels: " + labels : ""}`,
          project: proj.name,
          priority: labels.includes("bug") ? 2 : 5,
          estimatedCost: "medium",
          suggestedModel: "openai/gpt-4o-mini",
        });
      }
    }

    // Suggest cleanup for dirty files
    if (proj.dirtyFiles.length > 0) {
      suggestions.push({
        title: `Clean up uncommitted changes in ${proj.name}`,
        description: `${proj.dirtyFiles.length} files have uncommitted changes: ${proj.dirtyFiles.slice(0, 5).join(", ")}`,
        project: proj.name,
        priority: 4,
        estimatedCost: "low",
        suggestedModel: "openai/gpt-4.1-nano",
      });
    }

    // Suggest tests/docs if project has recent activity
    if (proj.commits.length >= 3) {
      const recentCommitText = proj.commits.slice(0, 3).join("; ");
      suggestions.push({
        title: `Add test coverage for recent changes in ${proj.name}`,
        description: `Recent commits: ${recentCommitText}. Ensure new code has tests.`,
        project: proj.name,
        priority: 5,
        estimatedCost: "medium",
        suggestedModel: "openai/gpt-4o-mini",
      });
    }
  }

  return suggestions.slice(0, 5);
}

// Extract JSON array from agent output (tries multiple strategies)
function extractJsonArray(output) {
  // Strategy 1: Find ```json ... ``` code block
  const codeBlockMatch = output.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]); } catch { /* continue */ }
  }

  // Strategy 2: Find outermost [ ... ] pair
  const firstBracket = output.indexOf("[");
  const lastBracket = output.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try { return JSON.parse(output.slice(firstBracket, lastBracket + 1)); } catch { /* continue */ }
  }

  // Strategy 3: Try to find individual JSON objects and assemble array
  const objMatches = [...output.matchAll(/\{[^{}]*"title"\s*:\s*"[^"]+?"[^{}]*\}/g)];
  if (objMatches.length > 0) {
    const objects = [];
    for (const m of objMatches) {
      try { objects.push(JSON.parse(m[0])); } catch { /* skip */ }
    }
    if (objects.length > 0) return objects;
  }

  return null;
}

app.post("/setup/api/runner/suggest", requireDashAuth, async (req, res) => {
  const { project, mode } = req.body || {};
  try {
    const queue = readTaskQueue();
    const projectData = await gatherProjectContext(project);

    // "quick" mode: skip AI, return context-based suggestions immediately
    if (mode === "quick" || projectData.length === 0) {
      const suggestions = generateContextSuggestions(projectData, queue.history || []);
      return res.json({ ok: true, suggestions, source: "context" });
    }

    // Build context string for AI
    const contextParts = projectData.map(p => {
      const parts = [`## Project: ${p.name}`];
      if (p.claudeMd) parts.push("CLAUDE.md: " + p.claudeMd);
      if (p.commits.length) parts.push("Recent commits:\n" + p.commits.slice(0, 5).join("\n"));
      if (p.dirtyFiles.length) parts.push("Dirty files:\n" + p.dirtyFiles.slice(0, 5).join("\n"));
      if (p.issues.length) parts.push("Open issues: " + JSON.stringify(p.issues.slice(0, 3)));
      return parts.join("\n");
    });

    const recentHistory = (queue.history || []).slice(-10).map(t => `${t.title} (${t.status})`).join(", ");

    const prompt = [
      "IMPORTANT: Respond with ONLY a JSON array. No markdown, no explanation, no code fences.",
      "Generate 3-5 high-value development tasks as a JSON array.",
      "Each object must have: title (string), description (string), project (repo name string), priority (number 1-10), estimatedCost (\"low\"|\"medium\"|\"high\"), suggestedModel (string like \"openai/gpt-4o-mini\").",
      "",
      "Example output format:",
      '[{"title":"Add auth middleware tests","description":"The auth module lacks unit tests for edge cases","project":"Project-AtlasIT","priority":3,"estimatedCost":"medium","suggestedModel":"openai/gpt-4o-mini"}]',
      "",
      recentHistory ? `Recently completed (avoid duplicates): ${recentHistory}` : "",
      "",
      ...contextParts,
    ].filter(Boolean).join("\n");

    const agentRes = await runCmd(OPENCLAW_NODE, clawArgs([
      "agent", "--session-id", "task-suggest",
      "--message", prompt,
      "--timeout", "60",
    ]));

    const output = agentRes.output || "";
    const parsed = extractJsonArray(output);
    if (parsed && Array.isArray(parsed) && parsed.length > 0) {
      // Validate and sanitize each suggestion
      const suggestions = parsed.filter(s => s && typeof s.title === "string").map(s => ({
        title: String(s.title).slice(0, 200),
        description: String(s.description || "").slice(0, 500),
        project: String(s.project || "").slice(0, 100),
        priority: Number.isInteger(s.priority) && s.priority >= 1 && s.priority <= 10 ? s.priority : 5,
        estimatedCost: ["low", "medium", "high"].includes(s.estimatedCost) ? s.estimatedCost : "medium",
        suggestedModel: String(s.suggestedModel || "openai/gpt-4o-mini").slice(0, 50),
      }));
      if (suggestions.length > 0) {
        return res.json({ ok: true, suggestions, source: "ai" });
      }
    }

    // AI failed to return parseable JSON — fall back to context-based suggestions
    const fallback = generateContextSuggestions(projectData, queue.history || []);
    return res.json({
      ok: true,
      suggestions: fallback,
      source: "context-fallback",
      raw: fallback.length === 0 ? output.slice(0, 2000) : undefined,
    });
  } catch (err) {
    // Even on error, try to return something useful
    try {
      const projectData = await gatherProjectContext(project);
      const queue = readTaskQueue();
      const fallback = generateContextSuggestions(projectData, queue.history || []);
      if (fallback.length > 0) {
        return res.json({ ok: true, suggestions: fallback, source: "context-fallback", warning: err.message });
      }
    } catch { /* double failure */ }
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Chat API (SSE streaming) ────────────────────────────────────────────

app.post("/setup/api/chat/send", requireDashAuth, async (req, res) => {
  const { message, sessionId, model } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ ok: false, error: "Missing message" });
  }

  const user = req.dashUser;
  const sid = (typeof sessionId === "string" && sessionId.trim())
    ? sessionId.trim().slice(0, 100)
    : `chat-${Date.now()}`;

  // Rate limit (owner exempt)
  if (user.role !== "owner") {
    const rl = chatRateLimiter.check(user.id);
    if (rl.limited) {
      return res.status(429).json({ ok: false, error: `Rate limited. Retry in ${rl.retryAfter}s.` });
    }
  }

  // Check concurrent session limit
  const concCheck = checkConcurrentLimit(user.id, user.role);
  if (!concCheck.allowed) {
    return res.status(429).json({ ok: false, error: concCheck.reason });
  }

  // ── Phase 1: Triage (no side effects) ──
  const { triage, triageModel, pool } = await triageAndSelect(message);
  const modelTier = triageModel?.tier || "free";

  // Check model quota BEFORE any side effects
  const quotaCheck = checkUserQuota(user.id, user.role, modelTier);
  if (!quotaCheck.allowed) {
    appendActivity("quota_exceeded", { userId: user.id, modelTier, reason: quotaCheck.reason }, user);
    return res.status(429).json({ ok: false, error: quotaCheck.reason });
  }

  // ── Phase 2: Compress + model-switch (side effects, after quota passes) ──
  const { previousModel, compression, agentMessage } =
    await prepareForAgent(message, sid, triage, triageModel, pool);

  // Track session and usage
  trackSession(user.id, sid);
  incrementUserUsage(user.id, modelTier);

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const engineCfg = readTaskQueue().config.engines?.openclaw || {};
  const timeout = engineCfg.timeout || 180;

  const agentArgs = [
    "agent", "--session-id", sid,
    "--message", agentMessage,
    "--timeout", String(timeout),
  ];

  // Inject BYOK keys for non-owner users (owner uses instance keys)
  const byokEnv = (user.role !== "owner") ? buildByokEnv(user.id) : {};

  const proc = childProcess.spawn(OPENCLAW_NODE, clawArgs(agentArgs), {
    env: {
      ...process.env,
      ...byokEnv,
      OPENCLAW_STATE_DIR: STATE_DIR,
      OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
    },
  });

  let fullOutput = "";

  function sendSSE(event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
  }

  sendSSE("status", { status: "started", sessionId: sid, triageTier: triage.tier, model: triageModel?.id, compressed: !!compression, compressionMs: compression?.elapsed || 0 });

  proc.stdout?.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    fullOutput += text;
    sendSSE("chunk", { text });
  });

  proc.stderr?.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    fullOutput += text;
    sendSSE("chunk", { text });
  });

  proc.on("close", (code) => {
    untrackSession(user.id, sid);
    sendSSE("done", {
      code, output: fullOutput.slice(-5000), triageTier: triage.tier, model: triageModel?.id,
      compressed: !!compression,
      compressionSavings: compression ? { originalChars: compression.originalChars, briefingChars: compression.briefingChars, reductionPct: Math.round((1 - compression.briefingChars / compression.originalChars) * 100) } : null,
    });
    appendActivity("chat_message", { sessionId: sid, length: message.length, triageTier: triage.tier, model: triageModel?.id, compressed: !!compression, compressionMs: compression?.elapsed }, user);
    // Restore previous model after completion
    if (previousModel && triageModel && previousModel !== triageModel.id) {
      runCmd(OPENCLAW_NODE, clawArgs(["models", "set", previousModel])).catch(() => {});
    }
    try { res.end(); } catch { /* already closed */ }
  });

  proc.on("error", (err) => {
    untrackSession(user.id, sid);
    sendSSE("error", { message: err.message });
    if (previousModel && triageModel && previousModel !== triageModel.id) {
      runCmd(OPENCLAW_NODE, clawArgs(["models", "set", previousModel])).catch(() => {});
    }
    try { res.end(); } catch { /* already closed */ }
  });

  // If client disconnects, kill the process
  req.on("close", () => {
    untrackSession(user.id, sid);
    try { proc.kill("SIGTERM"); } catch { /* already exited */ }
  });
});

// Get chat session history (list available sessions)
app.get("/setup/api/chat/sessions", requireSetupAuth, async (_req, res) => {
  try {
    const r = await runCmd(OPENCLAW_NODE, clawArgs(["sessions", "--json"]));
    const output = (r.output || "").trim();
    let sessions = [];
    if (output) {
      try {
        const parsed = JSON.parse(output);
        sessions = Array.isArray(parsed) ? parsed : (parsed.sessions || parsed.data || []);
      } catch { /* not parseable */ }
    }
    return res.json({ ok: true, sessions });
  } catch {
    return res.json({ ok: true, sessions: [] });
  }
});

// ── Connection / Dashboard Status ───────────────────────────────────────

app.get("/setup/api/connection", requireDashAuth, async (_req, res) => {
  const uptime = process.uptime();
  const mem = process.memoryUsage();
  let gatewayPing = false;
  try {
    const r = await fetch(`http://127.0.0.1:${process.env.INTERNAL_GATEWAY_PORT || 18789}/health`, { signal: AbortSignal.timeout(3000) });
    gatewayPing = r.ok;
  } catch { /* gateway not reachable */ }

  return res.json({
    ok: true,
    connected: true,
    gateway: gatewayPing,
    uptime: Math.floor(uptime),
    memory: Math.floor(mem.rss / 1024 / 1024),
    timestamp: new Date().toISOString(),
  });
});

// Resume/send a message into an existing session (SSE streaming)
app.post("/setup/api/sessions/resume", requireSetupAuth, (req, res) => {
  const { sessionId, message } = req.body || {};
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ ok: false, error: "Missing sessionId" });
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ ok: false, error: "Missing message" });
  }

  // SSE streaming
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const engineCfg = readTaskQueue().config.engines?.openclaw || {};
  const timeout = engineCfg.timeout || 180;

  const agentArgs = [
    "agent", "--session-id", sessionId.trim().slice(0, 100),
    "--message", message.trim().slice(0, 10000),
    "--timeout", String(timeout),
  ];

  const proc = childProcess.spawn(OPENCLAW_NODE, clawArgs(agentArgs), {
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: STATE_DIR,
      OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
    },
  });

  let fullOutput = "";

  function sendSSE(event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
  }

  sendSSE("status", { status: "started", sessionId });

  proc.stdout?.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    fullOutput += text;
    sendSSE("chunk", { text });
  });

  proc.stderr?.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    fullOutput += text;
    sendSSE("chunk", { text });
  });

  proc.on("close", (code) => {
    sendSSE("done", { code, output: fullOutput.slice(-5000) });
    appendActivity("session_message", { sessionId, length: message.length });
    try { res.end(); } catch { /* already closed */ }
  });

  proc.on("error", (err) => {
    sendSSE("error", { message: err.message });
    try { res.end(); } catch { /* already closed */ }
  });

  req.on("close", () => {
    try { proc.kill("SIGTERM"); } catch { /* already exited */ }
  });
});

// ── News Ticker API ─────────────────────────────────────────────────────

const TICKER_CONFIG_PATH = path.join(STATE_DIR, "ticker-config.json");

function readTickerConfig() {
  try {
    return JSON.parse(fs.readFileSync(TICKER_CONFIG_PATH, "utf8"));
  } catch {
    return {
      enabled: true,
      speed: 30,
      sources: {
        marketAgents: { enabled: true, label: "Market Data" },
        manual: { enabled: true, items: [] },
      },
    };
  }
}

function writeTickerConfig(config) {
  fs.writeFileSync(TICKER_CONFIG_PATH, JSON.stringify(config, null, 2));
}

app.get("/setup/api/ticker/config", requireSetupAuth, (_req, res) => {
  return res.json({ ok: true, config: readTickerConfig() });
});

app.post("/setup/api/ticker/config", requireSetupAuth, (req, res) => {
  const config = readTickerConfig();
  const { enabled, speed, sources } = req.body || {};
  if (typeof enabled === "boolean") config.enabled = enabled;
  if (typeof speed === "number" && speed >= 5 && speed <= 120) config.speed = speed;
  if (sources && typeof sources === "object") {
    if (sources.marketAgents && typeof sources.marketAgents === "object") {
      config.sources.marketAgents = { ...config.sources.marketAgents, ...sources.marketAgents };
    }
    if (sources.manual && typeof sources.manual === "object") {
      if (Array.isArray(sources.manual.items)) {
        config.sources.manual.items = sources.manual.items
          .filter(i => typeof i === "string")
          .slice(0, 50)
          .map(i => i.slice(0, 500));
      }
      if (typeof sources.manual.enabled === "boolean") config.sources.manual.enabled = sources.manual.enabled;
    }
  }
  writeTickerConfig(config);
  return res.json({ ok: true, config });
});

// ── Market Data Ticker ──────────────────────────────────────────────────

app.get("/setup/api/market/ticker", requireSetupAuth, async (_req, res) => {
  // Query market_agents SQLite database for recent data
  const dbPath = path.join(WORKSPACE_DIR, "market_agents", "data", "market_agents.db");
  const items = [];

  try {
    // Recent arb signals
    const signals = await runCmd("sh", ["-c",
      `sqlite3 -json "${dbPath}" "SELECT * FROM arb_signals ORDER BY rowid DESC LIMIT 10" 2>/dev/null || echo "[]"`
    ]);
    try {
      const parsed = JSON.parse(signals.output || "[]");
      for (const s of parsed.slice(0, 5)) {
        items.push({
          type: "signal",
          text: `${s.event || s.market || "Signal"}: ${s.signal_type || s.direction || ""} ${s.edge ? `(edge: ${s.edge})` : ""}`.trim(),
          ts: s.timestamp || s.created_at || new Date().toISOString(),
          source: "market_agents",
        });
      }
    } catch { /* skip */ }

    // Recent fills/trades
    const fills = await runCmd("sh", ["-c",
      `sqlite3 -json "${dbPath}" "SELECT * FROM kalshi_fills ORDER BY rowid DESC LIMIT 10" 2>/dev/null || echo "[]"`
    ]);
    try {
      const parsed = JSON.parse(fills.output || "[]");
      for (const f of parsed.slice(0, 5)) {
        const side = f.side || f.action || "";
        const price = f.price || f.fill_price || "";
        items.push({
          type: "trade",
          text: `${f.ticker || f.market || "Trade"}: ${side} @ ${price}`.trim(),
          ts: f.created_time || f.timestamp || new Date().toISOString(),
          source: "market_agents",
        });
      }
    } catch { /* skip */ }

    // Recent positions
    const positions = await runCmd("sh", ["-c",
      `sqlite3 -json "${dbPath}" "SELECT * FROM positions ORDER BY rowid DESC LIMIT 5" 2>/dev/null || echo "[]"`
    ]);
    try {
      const parsed = JSON.parse(positions.output || "[]");
      for (const p of parsed.slice(0, 3)) {
        items.push({
          type: "position",
          text: `Position: ${p.ticker || p.market || "?"} ${p.side || ""} qty:${p.quantity || p.count || "?"}`.trim(),
          ts: p.updated_at || p.created_at || new Date().toISOString(),
          source: "market_agents",
        });
      }
    } catch { /* skip */ }
  } catch (err) {
    // DB not found or sqlite3 not available — that's fine
    console.warn("[market-ticker] query error:", err.message);
  }

  return res.json({ ok: true, items });
});

// ── API Token Management Endpoints ──────────────────────────────────────

app.get("/setup/api/tokens", requireSetupAuth, (_req, res) => {
  const tokens = readApiTokens();
  // Return tokens but mask the actual token value
  const masked = tokens.map(t => ({
    ...t,
    token: t.token.slice(0, 8) + "..." + t.token.slice(-4),
    _fullToken: undefined,
  }));
  return res.json({ ok: true, tokens: masked });
});

app.post("/setup/api/tokens/create", requireSetupAuth, (req, res) => {
  const { name, scopes } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ ok: false, error: "Missing token name" });
  }
  const token = `jclaw_${crypto.randomBytes(32).toString("hex")}`;
  const tokenEntry = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 100),
    token,
    scopes: Array.isArray(scopes) ? scopes.filter(s => typeof s === "string").slice(0, 20) : ["read", "write", "agent"],
    createdAt: new Date().toISOString(),
    lastUsed: null,
    revoked: false,
  };

  const tokens = readApiTokens();
  tokens.push(tokenEntry);
  writeApiTokens(tokens);
  appendActivity("token_created", { name: tokenEntry.name, id: tokenEntry.id });

  // Return the full token ONCE (user must copy it now)
  return res.json({ ok: true, token: tokenEntry });
});

app.post("/setup/api/tokens/revoke", requireSetupAuth, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: "Missing token id" });

  const tokens = readApiTokens();
  const token = tokens.find(t => t.id === id);
  if (!token) return res.status(404).json({ ok: false, error: "Token not found" });

  token.revoked = true;
  token.revokedAt = new Date().toISOString();
  writeApiTokens(tokens);
  appendActivity("token_revoked", { name: token.name, id: token.id });

  return res.json({ ok: true });
});

// ── External API (token-authenticated for local AI builds) ──────────────

function requireApiToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Bearer token" });
  }

  const entry = validateApiToken(token);
  if (!entry) {
    return res.status(403).json({ ok: false, error: "Invalid or revoked token" });
  }

  // Update last used
  const tokens = readApiTokens();
  const t = tokens.find(x => x.id === entry.id);
  if (t) { t.lastUsed = new Date().toISOString(); writeApiTokens(tokens); }

  req.apiToken = entry;
  next();
}

// External API: health check
app.get("/api/v1/health", requireApiToken, (_req, res) => {
  return res.json({ ok: true, gateway: isGatewayReady(), version: cachedOpenclawVersion });
});

// External API: send message to agent
app.post("/api/v1/agent/message", requireApiToken, async (req, res) => {
  const { message, sessionId, timeout } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ ok: false, error: "Missing message" });
  }
  const sid = (typeof sessionId === "string" && sessionId.trim()) ? sessionId.trim().slice(0, 100) : `api-${Date.now()}`;
  const tout = Math.min(Math.max(Number(timeout) || 120, 10), 600);

  // Rate limit by API token
  const rl = apiRateLimiter.check(req.apiToken.id);
  if (rl.limited) {
    return res.status(429).json({ ok: false, error: `Rate limited. Retry in ${rl.retryAfter}s.` });
  }

  // ── Phase 1: Triage (no side effects) ──
  const { triage, triageModel, pool } = await triageAndSelect(message);

  // ── Phase 2: Compress + model-switch (side effects) ──
  const { previousModel, compression, agentMessage } =
    await prepareForAgent(message, sid, triage, triageModel, pool);

  // SSE streaming response
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const proc = childProcess.spawn(OPENCLAW_NODE, clawArgs([
    "agent", "--session-id", sid,
    "--message", agentMessage,
    "--timeout", String(tout),
  ]), {
    env: { ...process.env, OPENCLAW_STATE_DIR: STATE_DIR, OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR },
  });

  let fullOutput = "";
  function sendSSE(event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
  }

  sendSSE("status", { sessionId: sid, triageTier: triage.tier, model: triageModel?.id, compressed: !!compression, compressionMs: compression?.elapsed || 0 });
  proc.stdout?.on("data", (d) => { const t = d.toString("utf8"); fullOutput += t; sendSSE("chunk", { text: t }); });
  proc.stderr?.on("data", (d) => { const t = d.toString("utf8"); fullOutput += t; sendSSE("chunk", { text: t }); });
  proc.on("close", (code) => {
    sendSSE("done", {
      code, output: fullOutput.slice(-5000), triageTier: triage.tier, model: triageModel?.id,
      compressed: !!compression,
      compressionSavings: compression ? { originalChars: compression.originalChars, briefingChars: compression.briefingChars, reductionPct: Math.round((1 - compression.briefingChars / compression.originalChars) * 100) } : null,
    });
    appendActivity("api_agent_message", { sessionId: sid, tokenName: req.apiToken.name, triageTier: triage.tier, model: triageModel?.id, compressed: !!compression, compressionMs: compression?.elapsed });
    if (previousModel && triageModel && previousModel !== triageModel.id) {
      runCmd(OPENCLAW_NODE, clawArgs(["models", "set", previousModel])).catch(() => {});
    }
    try { res.end(); } catch { /* closed */ }
  });
  proc.on("error", (err) => {
    if (previousModel && triageModel && previousModel !== triageModel.id) {
      runCmd(OPENCLAW_NODE, clawArgs(["models", "set", previousModel])).catch(() => {});
    }
    sendSSE("error", { message: err.message });
    try { res.end(); } catch { /* closed */ }
  });
  req.on("close", () => { try { proc.kill("SIGTERM"); } catch { /* exited */ } });
});

// External API: get status
app.get("/api/v1/status", requireApiToken, async (_req, res) => {
  const queue = readTaskQueue();
  return res.json({
    ok: true,
    gateway: isGatewayReady(),
    tasksQueued: queue.tasks.length,
    tasksToday: queue.history.filter(t => t.completedAt && t.completedAt.startsWith(new Date().toISOString().slice(0, 10))).length,
    paused: queue.config.paused,
  });
});

// External API: add task
app.post("/api/v1/tasks/add", requireApiToken, (req, res) => {
  const { project, title, description, priority } = req.body || {};
  if (!title || typeof title !== "string") {
    return res.status(400).json({ ok: false, error: "Missing title" });
  }
  const queue = readTaskQueue();
  const task = {
    id: crypto.randomUUID(),
    project: typeof project === "string" ? project.slice(0, 200) : null,
    title: title.slice(0, 500),
    description: typeof description === "string" ? description.slice(0, 5000) : "",
    priority: Number.isInteger(priority) && priority >= 1 && priority <= 10 ? priority : 5,
    status: "pending",
    createdAt: new Date().toISOString(),
    source: `api:${req.apiToken.name}`,
  };
  queue.tasks.push(task);
  writeTaskQueue(queue);
  appendActivity("task_added", { id: task.id, title: task.title, source: task.source });
  return res.json({ ok: true, task });
});

// External API: list tasks
app.get("/api/v1/tasks", requireApiToken, (_req, res) => {
  const queue = readTaskQueue();
  return res.json({ ok: true, tasks: queue.tasks, config: queue.config });
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
app.get("/dashboard/{*path}", requireSetupAuth, (_req, res) => {
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
<body><div class="loader"><div class="spinner"></div><p>Connecting to JClaw…</p></div>
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
<noscript><a href="/openclaw?_boot=1">Continue to JClaw</a></noscript>
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
      // Start auto-scheduler, model scanner, and health monitor after gateway is ready
      startScheduler();
      startAutoScanner();
      startHealthMonitor();
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
      socket.write("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"JClaw TUI\"\r\n\r\n");
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
  stopScheduler();
  stopAutoScanner();
  stopHealthMonitor();

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
