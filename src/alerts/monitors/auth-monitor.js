import { sendAlert } from "../notifier.js";
import { isCoolingDown, setCooldown } from "../state.js";

const THRESHOLD = 5;
const WINDOW_MS = 60 * 1000; // 60 seconds
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes per IP

// Per-IP tracking: { ip: { count, firstSeen, lastSeen, endpoints: Set } }
const failures = new Map();

let cleanupTimer = null;

/**
 * Called from server.js when a setup auth attempt fails.
 * @param {object} opts
 * @param {string} opts.ip
 * @param {string} opts.endpoint
 */
export async function alertOnAuthFailure({ ip, endpoint }) {
  const now = Date.now();

  let entry = failures.get(ip);
  if (!entry || now - entry.firstSeen > WINDOW_MS) {
    entry = { count: 0, firstSeen: now, lastSeen: now, endpoints: new Set() };
    failures.set(ip, entry);
  }

  entry.count++;
  entry.lastSeen = now;
  entry.endpoints.add(endpoint);

  if (entry.count >= THRESHOLD) {
    const cooldownKey = `auth:${ip}`;
    if (!isCoolingDown(cooldownKey, COOLDOWN_MS)) {
      setCooldown(cooldownKey);

      await sendAlert("[AUTH ALERT]", [
        "Setup wizard brute force",
        `Source IP: ${ip}`,
        `Failed attempts: ${entry.count} in 60s`,
        `Endpoint: ${[...entry.endpoints].join(", ")}`,
      ].join("\n"), { monitor: "auth", ip, severity: "warning" });
    }

    failures.delete(ip);
  }
}

function cleanStale() {
  const now = Date.now();
  for (const [ip, entry] of failures) {
    if (now - entry.firstSeen > WINDOW_MS) {
      failures.delete(ip);
    }
  }
}

export function startAuthMonitor() {
  cleanupTimer = setInterval(cleanStale, WINDOW_MS);
  console.log(`[alerts/auth] monitoring setup auth failures — threshold=${THRESHOLD}/60s`);
}

export function stopAuthMonitor() {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}

export function getAuthMonitorStatus() {
  return {
    enabled: true,
    threshold: THRESHOLD,
    windowSeconds: WINDOW_MS / 1000,
    activeTracking: failures.size,
  };
}
