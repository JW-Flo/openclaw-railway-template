/**
 * safe-exec.js — secure child-process spawn wrapper
 *
 * Enforces shell:false, validates commands against an allowlist,
 * and provides defense-in-depth for all spawn call sites.
 */

import childProcess from "node:child_process";

const CMD_ALLOWLIST = new Set([
  "node",
  "openclaw",
  "git",
  "npm",
  "pnpm",
  "cat",
  "ls",
  "find",
  "grep",
  "wc",
  "head",
  "tail",
  "df",
  "free",
  "ps",
  "uptime",
  "whoami",
  "echo",
  "env",
  "printenv",
  "sh",
  "bash",
  "python3",
  "jq",
  "curl",
  "wget",
  "gh",        // GitHub CLI — used by project-context, skills
  "clawhub",   // OpenClaw skill manager — used by skills API
  "wrangler",  // Cloudflare CLI — installed in Docker
  "railway",   // Railway CLI — installed in Docker
]);

/**
 * Spawn a child process with security hardening.
 * Always sets shell:false. Validates cmd against allowlist.
 *
 * @param {string} cmd — the executable to run
 * @param {string[]} args — array of arguments (never a single shell string)
 * @param {object} [opts] — options forwarded to child_process.spawn
 * @param {object} [opts.bypassAllowlist] — internal flag for trusted callers (gateway, openclaw CLI)
 * @returns {import("node:child_process").ChildProcess}
 * @throws {Error} if cmd is not in the allowlist
 */
export function safeSpawn(cmd, args = [], opts = {}) {
  const { bypassAllowlist, ...spawnOpts } = opts;

  // Always enforce shell:false to prevent shell injection
  spawnOpts.shell = false;

  // Validate command against allowlist
  const baseName = cmd.split("/").pop();
  if (!bypassAllowlist && !CMD_ALLOWLIST.has(baseName)) {
    throw new Error(
      `[safe-exec] Command not allowed: "${cmd}". Allowed: ${[...CMD_ALLOWLIST].join(", ")}`,
    );
  }

  // Validate all args are strings (prevent accidental object injection)
  for (let i = 0; i < args.length; i++) {
    if (typeof args[i] !== "string") {
      throw new Error(
        `[safe-exec] Argument at index ${i} must be a string, got ${typeof args[i]}`,
      );
    }
  }

  return childProcess.spawn(cmd, args, spawnOpts);
}

/**
 * Run a command and collect stdout+stderr into a string.
 * Returns { code, output }.
 */
export function safeRun(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = safeSpawn(cmd, args, opts);
    } catch (err) {
      return resolve({ code: 126, output: `[safe-exec] ${err.message}\n` });
    }

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

/**
 * Check whether a command is in the allowlist (for shell API validation).
 */
export function isCommandAllowed(cmd) {
  const baseName = (cmd || "").split("/").pop();
  return CMD_ALLOWLIST.has(baseName);
}

export { CMD_ALLOWLIST };
