import childProcess from "node:child_process";
import { sendAlert } from "../notifier.js";
import { isCoolingDown, setCooldown, getDiskUsage, setDiskUsage } from "../state.js";
import { schedule, reschedule } from "../scheduler.js";

const WARN_PERCENT = Number(process.env.ALERTS_DISK_WARN_PERCENT) || 85;
const CRIT_PERCENT = Number(process.env.ALERTS_DISK_CRIT_PERCENT) || 90;
const CHECK_INTERVAL_MIN = Number(process.env.ALERTS_DISK_CHECK_INTERVAL_MINUTES) || 5;
const COOLDOWN_MIN = Number(process.env.ALERTS_DISK_COOLDOWN_MINUTES) || 30;
const COOLDOWN_MS = COOLDOWN_MIN * 60 * 1000;
const ESCALATED_INTERVAL_MS = 60 * 1000; // 1 minute when critical

let normalIntervalMs = CHECK_INTERVAL_MIN * 60 * 1000;
let escalated = false;

function parseDf() {
  return new Promise((resolve) => {
    const proc = childProcess.spawn("df", ["--output=source,pcent,avail,size,target", "-x", "tmpfs", "-x", "devtmpfs"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });

    let stdout = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.on("error", () => resolve([]));
    proc.on("close", () => {
      const lines = stdout.trim().split("\n").slice(1); // skip header
      const results = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const [source, pcentStr, availStr, sizeStr, ...targetParts] = parts;
        const percent = parseInt(pcentStr, 10);
        const avail = parseInt(availStr, 10); // 1K blocks
        const size = parseInt(sizeStr, 10);
        const target = targetParts.join(" ");
        if (Number.isNaN(percent)) continue;
        results.push({ source, percent, availKB: avail, sizeKB: size, target });
      }
      resolve(results);
    });
  });
}

function formatSize(kb) {
  if (kb >= 1_048_576) return `${(kb / 1_048_576).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

async function checkDisk() {
  const filesystems = await parseDf();
  if (filesystems.length === 0) return;

  let anyCritical = false;

  for (const fs of filesystems) {
    // Only monitor / and /data (the Railway volume)
    if (fs.target !== "/" && fs.target !== "/data") continue;

    const prevUsage = getDiskUsage(fs.target);
    setDiskUsage(fs.target, fs.percent);

    const cooldownKey = `disk:${fs.target}`;

    if (fs.percent >= CRIT_PERCENT) {
      anyCritical = true;
      const jumpedSinceLastCheck = prevUsage !== undefined && (fs.percent - prevUsage) >= 5;

      if (!isCoolingDown(cooldownKey + ":critical", COOLDOWN_MS) || jumpedSinceLastCheck) {
        const usedKB = fs.sizeKB - fs.availKB;
        const trend = prevUsage !== undefined ? `${fs.percent - prevUsage >= 0 ? "+" : ""}${fs.percent - prevUsage}% since last check` : "first check";
        await sendAlert("[DISK CRITICAL]", [
          `${fs.target} at ${fs.percent}%`,
          `Filesystem: ${fs.source} mounted on ${fs.target}`,
          `Used: ${formatSize(usedKB)} / ${formatSize(fs.sizeKB)}`,
          `Available: ${formatSize(fs.availKB)}`,
          `Trend: ${trend}`,
          "",
          "Action: Free space or expand Railway volume",
        ].join("\n"), { monitor: "disk", mountpoint: fs.target, percent: fs.percent, severity: "critical" });

        setCooldown(cooldownKey + ":critical");
      }
    } else if (fs.percent >= WARN_PERCENT) {
      if (!isCoolingDown(cooldownKey + ":warning", COOLDOWN_MS)) {
        const usedKB = fs.sizeKB - fs.availKB;
        await sendAlert("[DISK WARNING]", [
          `${fs.target} at ${fs.percent}%`,
          `Filesystem: ${fs.source} mounted on ${fs.target}`,
          `Used: ${formatSize(usedKB)} / ${formatSize(fs.sizeKB)}`,
          `Available: ${formatSize(fs.availKB)}`,
          "",
          "Action: Free space or expand Railway volume",
        ].join("\n"), { monitor: "disk", mountpoint: fs.target, percent: fs.percent, severity: "warning" });

        setCooldown(cooldownKey + ":warning");
      }
    } else if (prevUsage !== undefined && prevUsage >= WARN_PERCENT && fs.percent < WARN_PERCENT) {
      // Resolved — usage dropped below warning threshold
      await sendAlert("[DISK RESOLVED]", [
        `${fs.target} back to ${fs.percent}%`,
        `Previously at ${prevUsage}%. Issue resolved.`,
      ].join("\n"), { monitor: "disk", mountpoint: fs.target, percent: fs.percent, severity: "info" });
    }
  }

  // Escalate/de-escalate check interval
  if (anyCritical && !escalated) {
    escalated = true;
    reschedule("disk-monitor", ESCALATED_INTERVAL_MS);
    console.log("[alerts/disk] escalated to 1-minute checks");
  } else if (!anyCritical && escalated) {
    escalated = false;
    reschedule("disk-monitor", normalIntervalMs);
    console.log("[alerts/disk] de-escalated to normal interval");
  }
}

export function startDiskMonitor() {
  if (process.env.ALERTS_DISK_ENABLED === "false") {
    console.log("[alerts/disk] disabled via ALERTS_DISK_ENABLED=false");
    return;
  }

  console.log(`[alerts/disk] starting — warn=${WARN_PERCENT}% crit=${CRIT_PERCENT}% interval=${CHECK_INTERVAL_MIN}min`);
  schedule("disk-monitor", normalIntervalMs, checkDisk, { initialDelayMs: 30_000 });
}

export function getDiskStatus() {
  return {
    enabled: process.env.ALERTS_DISK_ENABLED !== "false",
    warnPercent: WARN_PERCENT,
    critPercent: CRIT_PERCENT,
    checkIntervalMin: CHECK_INTERVAL_MIN,
    escalated,
  };
}
