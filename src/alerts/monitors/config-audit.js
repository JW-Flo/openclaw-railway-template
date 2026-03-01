import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sendAlert } from "../notifier.js";
import { getBaselines, setBaselines } from "../state.js";
import { schedule } from "../scheduler.js";

let stateDir = "";
let projectRoot = "";

const AUDIT_HOUR = 6; // 06:00 UTC default
const REPORT_ALL_CLEAR = process.env.ALERTS_AUDIT_REPORT_ALL_CLEAR !== "false";

function getMonitoredFiles() {
  const files = [];

  // Application configs (always monitored)
  files.push(path.join(stateDir, "openclaw.json"));
  files.push(path.join(stateDir, "gateway.token"));
  files.push(path.join(projectRoot, "package.json"));
  files.push(path.join(projectRoot, "Dockerfile"));
  files.push(path.join(projectRoot, "railway.toml"));

  // System configs (monitored if readable)
  for (const sysFile of ["/etc/passwd", "/etc/group", "/etc/shadow", "/etc/ssh/sshd_config", "/etc/sudoers"]) {
    try {
      fs.accessSync(sysFile, fs.constants.R_OK);
      files.push(sysFile);
    } catch {
      // Not readable — skip
    }
  }

  // Custom files from env
  const extra = process.env.ALERTS_AUDIT_EXTRA_FILES?.trim();
  if (extra) {
    for (const f of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
      files.push(f);
    }
  }

  return files;
}

function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

function fileStats(filePath) {
  try {
    const st = fs.statSync(filePath);
    return { size: st.size, mtime: st.mtime.toISOString(), mode: st.mode };
  } catch {
    return null;
  }
}

export async function runAudit() {
  const files = getMonitoredFiles();
  const baselines = getBaselines();
  const modified = [];
  const newFiles = [];
  const missing = [];
  let unchanged = 0;

  const newBaselines = {};

  for (const filePath of files) {
    const hash = hashFile(filePath);
    const stats = fileStats(filePath);
    const baseline = baselines[filePath];

    if (hash === null && stats === null) {
      // File doesn't exist
      if (baseline) {
        missing.push(filePath);
      }
      continue;
    }

    newBaselines[filePath] = {
      hash,
      size: stats?.size || 0,
      mtime: stats?.mtime || "",
      mode: stats?.mode || 0,
      recordedAt: new Date().toISOString(),
    };

    if (!baseline) {
      newFiles.push(filePath);
    } else if (baseline.hash !== hash) {
      const sizeDelta = (stats?.size || 0) - (baseline.size || 0);
      modified.push({
        path: filePath,
        oldSize: baseline.size,
        newSize: stats?.size || 0,
        sizeDelta,
        modeChanged: baseline.mode !== stats?.mode,
      });
    } else {
      unchanged++;
    }
  }

  // Update baselines
  setBaselines(newBaselines);

  const hasChanges = modified.length > 0 || newFiles.length > 0 || missing.length > 0;

  if (!hasChanges && !REPORT_ALL_CLEAR) return;

  const nextAudit = new Date();
  nextAudit.setUTCDate(nextAudit.getUTCDate() + 1);
  nextAudit.setUTCHours(AUDIT_HOUR, 0, 0, 0);

  if (!hasChanges) {
    await sendAlert("[CONFIG AUDIT]", [
      "Daily report — all clear",
      `All ${unchanged} monitored files match baseline.`,
      `Next audit: ${nextAudit.toISOString().replace("T", " ").slice(0, 19)} UTC`,
    ].join("\n"), { monitor: "config-audit", severity: "info" });
    return;
  }

  const lines = ["Daily report — CHANGES DETECTED", ""];

  if (modified.length > 0) {
    lines.push("Modified:");
    for (const m of modified) {
      lines.push(`  ${m.path}`);
      lines.push(`    Size: ${m.oldSize} -> ${m.newSize} bytes (${m.sizeDelta >= 0 ? "+" : ""}${m.sizeDelta})`);
      if (m.modeChanged) lines.push("    Permissions: changed");
    }
    lines.push("");
  }

  if (newFiles.length > 0) {
    lines.push("New files:");
    for (const f of newFiles) {
      lines.push(`  ${f} (not previously tracked)`);
    }
    lines.push("");
  }

  if (missing.length > 0) {
    lines.push("Missing files:");
    for (const f of missing) {
      lines.push(`  ${f} (was tracked, now gone)`);
    }
    lines.push("");
  }

  lines.push(`Unchanged: ${unchanged} files`);
  lines.push(`Next audit: ${nextAudit.toISOString().replace("T", " ").slice(0, 19)} UTC`);

  await sendAlert("[CONFIG AUDIT]", lines.join("\n"), {
    monitor: "config-audit",
    severity: "warning",
    modified: modified.map((m) => m.path),
    newFiles,
    missing,
  });
}

/** Rebaseline: snapshot current state as the new known-good. */
export async function rebaseline() {
  const files = getMonitoredFiles();
  const baselines = {};
  for (const filePath of files) {
    const hash = hashFile(filePath);
    const stats = fileStats(filePath);
    if (hash !== null) {
      baselines[filePath] = {
        hash,
        size: stats?.size || 0,
        mtime: stats?.mtime || "",
        mode: stats?.mode || 0,
        recordedAt: new Date().toISOString(),
      };
    }
  }
  setBaselines(baselines);
  return { files: Object.keys(baselines).length };
}

export function startConfigAudit(opts) {
  if (process.env.ALERTS_AUDIT_ENABLED === "false") {
    console.log("[alerts/config-audit] disabled via ALERTS_AUDIT_ENABLED=false");
    return;
  }

  stateDir = opts.stateDir || "";
  projectRoot = opts.projectRoot || process.cwd();

  // Parse cron hour from ALERTS_AUDIT_CRON (simplified: just extract the hour)
  const cronExpr = process.env.ALERTS_AUDIT_CRON?.trim() || `0 ${AUDIT_HOUR} * * *`;
  const parsedCronHour = parseInt(cronExpr.split(/\s+/)[1], 10);
  const cronHour = Number.isNaN(parsedCronHour) ? AUDIT_HOUR : parsedCronHour;

  console.log(`[alerts/config-audit] starting — audit hour=${cronHour} UTC, report-all-clear=${REPORT_ALL_CLEAR}`);

  // Run once at startup with 60s delay (one-shot, not recurring)
  setTimeout(async () => {
    try {
      await runAudit();
    } catch (err) {
      console.warn(`[alerts/config-audit] startup audit error: ${err.message}`);
    }
  }, 60_000);

  // Check every 5 minutes — run audit if it's the right hour (avoids missing target)
  let lastAuditDay = -1;
  schedule("config-audit-daily", 5 * 60 * 1000, async () => {
    const now = new Date();
    const today = now.getUTCDate();
    if (now.getUTCHours() === cronHour && lastAuditDay !== today) {
      lastAuditDay = today;
      await runAudit();
    }
  }, { initialDelayMs: 5 * 60 * 1000 });
}

export function getAuditStatus() {
  const baselines = getBaselines();
  return {
    enabled: process.env.ALERTS_AUDIT_ENABLED !== "false",
    monitoredFiles: Object.keys(baselines).length,
    lastBaseline: Object.values(baselines).reduce((latest, b) => {
      return b.recordedAt > (latest || "") ? b.recordedAt : latest;
    }, null),
  };
}
