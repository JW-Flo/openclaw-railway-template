import { initState, shutdownState, getHistory } from "./state.js";
import { initNotifier } from "./notifier.js";
import { cancelAll, listJobs } from "./scheduler.js";
import { startDiskMonitor, getDiskStatus } from "./monitors/disk-monitor.js";
import { startConfigAudit, getAuditStatus, runAudit, rebaseline } from "./monitors/config-audit.js";
import { startSshMonitor, stopSshMonitor, getSshStatus } from "./monitors/ssh-monitor.js";
import { alertOnGatewayCrash, markGatewayStarted, getGatewayMonitorStatus } from "./monitors/gateway-monitor.js";
import { alertOnAuthFailure, startAuthMonitor, stopAuthMonitor, getAuthMonitorStatus } from "./monitors/auth-monitor.js";

let initialized = false;

/**
 * Initialize the alert system. Called from server.js after gateway starts.
 * @param {object} opts
 * @param {string} opts.stateDir - path to STATE_DIR
 * @param {string} [opts.projectRoot] - path to project root (for config audit)
 */
export function initAlerts(opts) {
  if (initialized) return;
  if (process.env.ALERTS_ENABLED === "false") {
    console.log("[alerts] disabled via ALERTS_ENABLED=false");
    return;
  }

  const { stateDir, projectRoot } = opts;
  console.log("[alerts] initializing alert system");

  // Core infrastructure
  initState(stateDir);
  initNotifier({ stateDir });

  // Start monitors
  startDiskMonitor();
  startConfigAudit({ stateDir, projectRoot });
  startSshMonitor();
  startAuthMonitor();

  // Gateway monitor doesn't need a scheduler — it's event-driven
  markGatewayStarted();

  initialized = true;
  console.log("[alerts] all monitors started");
}

/**
 * Shut down the alert system cleanly. Called on SIGTERM/SIGINT.
 */
export function shutdownAlerts() {
  if (!initialized) return;
  console.log("[alerts] shutting down");

  cancelAll();
  stopSshMonitor();
  stopAuthMonitor();
  shutdownState();

  initialized = false;
}

/**
 * Get the full status of all monitors.
 */
export function getAlertStatus() {
  return {
    enabled: process.env.ALERTS_ENABLED !== "false",
    initialized,
    channel: process.env.ALERTS_CHANNEL || "auto",
    chatId: process.env.ALERTS_CHAT_ID || process.env.ALERTS_CHANNEL_ID || "",
    monitors: {
      disk: getDiskStatus(),
      configAudit: getAuditStatus(),
      ssh: getSshStatus(),
      gateway: getGatewayMonitorStatus(),
      auth: getAuthMonitorStatus(),
    },
    scheduledJobs: listJobs(),
    recentAlerts: getHistory().slice(-20),
  };
}

// Re-export event-driven hooks for server.js
export { alertOnGatewayCrash } from "./monitors/gateway-monitor.js";
export { markGatewayStarted } from "./monitors/gateway-monitor.js";
export { alertOnAuthFailure } from "./monitors/auth-monitor.js";
export { runAudit, rebaseline } from "./monitors/config-audit.js";
