import { sendAlert } from "../notifier.js";
import { isCoolingDown, setCooldown } from "../state.js";

const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

let gatewayStartTime = null;

export function markGatewayStarted() {
  gatewayStartTime = Date.now();
}

/**
 * Called from server.js gatewayProc.on("exit") handler.
 * @param {object} opts
 * @param {number|null} opts.code - exit code
 * @param {string|null} opts.signal - signal that killed the process
 * @param {string[]} [opts.recentLogs] - last few log lines from gateway ring buffer
 * @param {number} [opts.restartDelaySec] - auto-restart delay in seconds (undefined if no restart)
 */
export async function alertOnGatewayCrash({ code, signal, recentLogs = [], restartDelaySec } = {}) {
  // Only alert on unexpected exits (non-zero or signal)
  if (code === 0 && !signal) return;

  const cooldownKey = "gateway:crash";
  if (isCoolingDown(cooldownKey, COOLDOWN_MS)) return;
  setCooldown(cooldownKey);

  const uptimeMs = gatewayStartTime ? Date.now() - gatewayStartTime : 0;
  const uptimeStr = formatUptime(uptimeMs);

  const logSection = recentLogs.length > 0
    ? `Recent log lines:\n${recentLogs.slice(-5).map((l) => `  ${l}`).join("\n")}`
    : "";

  const restartLine = restartDelaySec != null
    ? `Auto-restart: scheduled in ${restartDelaySec}s`
    : "Auto-restart: not scheduled";

  await sendAlert("[GATEWAY ALERT]", [
    "Process exited unexpectedly",
    `Exit code: ${code ?? "null"} | Signal: ${signal ?? "null"}`,
    restartLine,
    `Uptime before crash: ${uptimeStr}`,
    logSection,
  ].filter(Boolean).join("\n"), { monitor: "gateway", code, signal, severity: "critical" });
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function getGatewayMonitorStatus() {
  return {
    enabled: true,
    cooldownMinutes: 10,
    gatewayUpSince: gatewayStartTime ? new Date(gatewayStartTime).toISOString() : null,
  };
}
