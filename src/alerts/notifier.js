import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { pushAlert } from "./state.js";

let configDir = "";
let channel = "auto";   // auto | telegram | discord | slack | stdout
let chatId = "";         // Telegram chat ID or Discord/Slack channel ID

export function initNotifier(opts) {
  configDir = opts.stateDir || "";
  channel = process.env.ALERTS_CHANNEL?.trim() || "auto";
  chatId = process.env.ALERTS_CHAT_ID?.trim() || process.env.ALERTS_CHANNEL_ID?.trim() || "";
}

function readOpenclawConfig() {
  const cfgPath = path.join(configDir, "openclaw.json");
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return {};
  }
}

function resolveChannel() {
  if (channel !== "auto") return channel;

  const cfg = readOpenclawConfig();
  if (cfg.channels?.telegram?.botToken && chatId) return "telegram";
  if (cfg.channels?.discord?.token && chatId) return "discord";
  if (cfg.channels?.slack?.botToken && chatId) return "slack";
  return "stdout";
}

// ── HTTP helpers (no npm deps) ─────────────────────────────────────────────

function httpPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => { req.destroy(new Error("timeout")); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function sendTelegram(message) {
  const cfg = readOpenclawConfig();
  const token = cfg.channels?.telegram?.botToken;
  if (!token || !chatId) return false;

  try {
    const result = await httpPost(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {},
      { chat_id: chatId, text: message, parse_mode: "Markdown" },
    );
    return result.status >= 200 && result.status < 300;
  } catch (err) {
    console.warn(`[alerts/notifier] telegram send failed: ${err.message}`);
    return false;
  }
}

async function sendDiscord(message) {
  const cfg = readOpenclawConfig();
  const token = cfg.channels?.discord?.token;
  if (!token || !chatId) return false;

  try {
    const result = await httpPost(
      `https://discord.com/api/v10/channels/${chatId}/messages`,
      { Authorization: `Bot ${token}` },
      { content: message },
    );
    return result.status >= 200 && result.status < 300;
  } catch (err) {
    console.warn(`[alerts/notifier] discord send failed: ${err.message}`);
    return false;
  }
}

async function sendSlack(message) {
  const cfg = readOpenclawConfig();
  const token = cfg.channels?.slack?.botToken;
  if (!token || !chatId) return false;

  try {
    const result = await httpPost(
      "https://slack.com/api/chat.postMessage",
      { Authorization: `Bearer ${token}` },
      { channel: chatId, text: message },
    );
    return result.status >= 200 && result.status < 300;
  } catch (err) {
    console.warn(`[alerts/notifier] slack send failed: ${err.message}`);
    return false;
  }
}

/**
 * Send an alert via the configured channel. Always logs to stdout as well.
 * @param {string} prefix - e.g. "[DISK WARNING]", "[SSH ALERT]"
 * @param {string} message - the full alert message
 * @param {object} [meta] - optional metadata stored in history
 */
export async function sendAlert(prefix, message, meta = {}) {
  const fullMessage = `${prefix} ${message}`;

  // Always log to stdout with [SECURITY-ALERT] prefix for Railway log drain
  console.log(`[SECURITY-ALERT] ${fullMessage}`);

  // Record in history ring buffer
  pushAlert({ prefix, message: fullMessage, ...meta });

  // Try channel delivery
  const ch = resolveChannel();
  if (ch === "stdout") return;

  try {
    if (ch === "telegram") await sendTelegram(fullMessage);
    else if (ch === "discord") await sendDiscord(fullMessage);
    else if (ch === "slack") await sendSlack(fullMessage);
  } catch (err) {
    console.warn(`[alerts/notifier] ${ch} delivery failed: ${err.message}`);
  }
}
