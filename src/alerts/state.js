import fs from "node:fs";
import path from "node:path";

let stateDir = "";
let statePath = "";

/** Persistent alert state: baselines, cooldowns, history. */
let state = {
  baselines: {},      // { filePath: { hash, size, mtime, recordedAt } }
  cooldowns: {},      // { key: isoTimestamp }
  history: [],        // ring buffer of recent alerts (max 50)
  lastDiskUsage: {},  // { mountpoint: percentUsed } for trend tracking
};

const MAX_HISTORY = 50;

export function initState(dir) {
  stateDir = dir;
  statePath = path.join(stateDir, "alert-state.json");
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const loaded = JSON.parse(raw);
    state = { ...state, ...loaded };
  } catch {
    // Fresh state — write it out
    flushState();
  }
}

function flushState() {
  if (!statePath) return;
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tmp = statePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, statePath);
  } catch (err) {
    console.warn(`[alerts/state] flush failed: ${err.message}`);
  }
}

// ── Cooldowns ──────────────────────────────────────────────────────────────

export function isCoolingDown(key, cooldownMs) {
  const last = state.cooldowns[key];
  if (!last) return false;
  return Date.now() - new Date(last).getTime() < cooldownMs;
}

export function setCooldown(key) {
  state.cooldowns[key] = new Date().toISOString();
  flushState();
}

// ── Baselines ──────────────────────────────────────────────────────────────

export function getBaselines() {
  return state.baselines;
}

export function setBaselines(baselines) {
  state.baselines = baselines;
  flushState();
}

// ── Alert History ──────────────────────────────────────────────────────────

export function pushAlert(entry) {
  state.history.push({
    ...entry,
    ts: new Date().toISOString(),
  });
  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(-MAX_HISTORY);
  }
  flushState();
}

export function getHistory() {
  return state.history;
}

// ── Disk Usage Tracking ────────────────────────────────────────────────────

export function getDiskUsage(mountpoint) {
  return state.lastDiskUsage[mountpoint];
}

export function setDiskUsage(mountpoint, percent) {
  state.lastDiskUsage[mountpoint] = percent;
  flushState();
}

export function shutdownState() {
  flushState();
}
