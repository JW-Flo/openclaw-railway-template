import childProcess from "node:child_process";
import fs from "node:fs";
import { sendAlert } from "../notifier.js";
import { isCoolingDown, setCooldown } from "../state.js";

const THRESHOLD = Number(process.env.ALERTS_SSH_THRESHOLD) || 3;
const WINDOW_MS = (Number(process.env.ALERTS_SSH_WINDOW_SECONDS) || 60) * 1000;
const COOLDOWN_MS = (Number(process.env.ALERTS_SSH_COOLDOWN_MINUTES) || 5) * 60 * 1000;

const AUTH_LOG = "/var/log/auth.log";

// Per-IP attempt tracking: { ip: { count, usernames: Set, firstSeen, lastSeen } }
const attempts = new Map();
let watcher = null;
let journalProc = null;
let lastReadPos = 0;

const PATTERNS = [
  /Failed password for (?:invalid user )?(\S+) from (\S+)/,
  /Invalid user (\S+) from (\S+)/,
  /authentication failure.*rhost=(\S+).*user=(\S+)/,
  /Connection closed by authenticating user (\S+) (\S+)/,
];

function parseLine(line) {
  for (const pattern of PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      // Some patterns have user first, some IP first
      let user, ip;
      if (pattern.source.includes("rhost=")) {
        ip = match[1];
        user = match[2];
      } else {
        user = match[1];
        ip = match[2];
      }
      return { user, ip };
    }
  }
  return null;
}

function recordAttempt(ip, user) {
  const now = Date.now();

  let entry = attempts.get(ip);
  if (!entry || now - entry.firstSeen > WINDOW_MS) {
    entry = { count: 0, usernames: new Set(), firstSeen: now, lastSeen: now };
    attempts.set(ip, entry);
  }

  entry.count++;
  entry.usernames.add(user);
  entry.lastSeen = now;

  if (entry.count >= THRESHOLD) {
    fireAlert(ip, entry);
    attempts.delete(ip);
  }
}

async function fireAlert(ip, entry) {
  const cooldownKey = `ssh:${ip}`;
  if (isCoolingDown(cooldownKey, COOLDOWN_MS)) return;
  setCooldown(cooldownKey);

  await sendAlert("[SSH ALERT]", [
    "Brute force detected",
    `Source IP: ${ip}`,
    `Failed attempts: ${entry.count} in ${Math.round(WINDOW_MS / 1000)}s`,
    `Usernames tried: ${[...entry.usernames].join(", ")}`,
    `First seen: ${new Date(entry.firstSeen).toISOString()}`,
    `Last seen: ${new Date(entry.lastSeen).toISOString()}`,
  ].join("\n"), { monitor: "ssh", ip, severity: "critical" });
}

// Clean old windows periodically
function cleanStale() {
  const now = Date.now();
  for (const [ip, entry] of attempts) {
    if (now - entry.firstSeen > WINDOW_MS) {
      attempts.delete(ip);
    }
  }
}

function processChunk(text) {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parsed = parseLine(line);
    if (parsed) recordAttempt(parsed.ip, parsed.user);
  }
}

function watchAuthLog() {
  try {
    const stat = fs.statSync(AUTH_LOG);
    lastReadPos = stat.size; // Start from current end
  } catch {
    return false;
  }

  watcher = fs.watch(AUTH_LOG, () => {
    try {
      const stat = fs.statSync(AUTH_LOG);
      if (stat.size <= lastReadPos) {
        lastReadPos = 0; // Log was rotated
      }

      const fd = fs.openSync(AUTH_LOG, "r");
      const buf = Buffer.alloc(stat.size - lastReadPos);
      fs.readSync(fd, buf, 0, buf.length, lastReadPos);
      fs.closeSync(fd);
      lastReadPos = stat.size;

      processChunk(buf.toString("utf8"));
    } catch (err) {
      console.warn(`[alerts/ssh] auth.log read error: ${err.message}`);
    }
  });

  return true;
}

function watchJournalctl() {
  try {
    journalProc = childProcess.spawn(
      "journalctl",
      ["-u", "sshd", "-f", "--no-pager", "-o", "short-iso"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );

    let buffer = "";
    journalProc.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete last line
      for (const line of lines) {
        const parsed = parseLine(line);
        if (parsed) recordAttempt(parsed.ip, parsed.user);
      }
    });

    journalProc.on("error", () => {
      journalProc = null;
    });

    journalProc.on("exit", () => {
      journalProc = null;
    });

    return true;
  } catch {
    return false;
  }
}

let cleanupTimer = null;

export function startSshMonitor() {
  if (process.env.ALERTS_SSH_ENABLED === "false") {
    console.log("[alerts/ssh] disabled via ALERTS_SSH_ENABLED=false");
    return;
  }

  // Try auth.log first, fallback to journalctl
  if (watchAuthLog()) {
    console.log(`[alerts/ssh] monitoring ${AUTH_LOG} — threshold=${THRESHOLD} window=${WINDOW_MS / 1000}s`);
  } else if (watchJournalctl()) {
    console.log("[alerts/ssh] monitoring journalctl -u sshd");
  } else {
    console.log("[alerts/ssh] no log source available (container without sshd) — monitor disabled");
    return;
  }

  // Clean stale entries every window interval
  cleanupTimer = setInterval(cleanStale, WINDOW_MS);
}

export function stopSshMonitor() {
  if (watcher) { watcher.close(); watcher = null; }
  if (journalProc) { try { journalProc.kill(); } catch {} journalProc = null; }
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}

export function getSshStatus() {
  return {
    enabled: process.env.ALERTS_SSH_ENABLED !== "false",
    source: watcher ? "auth.log" : journalProc ? "journalctl" : "none",
    threshold: THRESHOLD,
    windowSeconds: WINDOW_MS / 1000,
    activeTracking: attempts.size,
  };
}
