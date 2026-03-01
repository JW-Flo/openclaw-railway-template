import { spawn } from 'node:child_process';

const ALLOWED_COMMANDS = new Set([
  'openclaw', 'node', 'git', 'npm', 'pnpm',
  'cat', 'ls', 'find', 'grep', 'wc',
  'head', 'tail', 'df', 'free', 'ps',
  'uptime', 'whoami', 'echo', 'env', 'printenv',
]);

const DANGEROUS_ARG_PATTERN = /[;|&$`\\]/;

/**
 * Validates that a command is in the allowlist.
 * Rejects commands with path separators to prevent path-traversal bypass.
 * @param {string} cmd
 * @returns {boolean}
 */
export function isCommandAllowed(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  if (cmd.includes('/')) return false;
  return ALLOWED_COMMANDS.has(cmd);
}

/**
 * Validates that args don't contain shell metacharacters.
 * @param {string[]} args
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateArgs(args) {
  if (!Array.isArray(args)) {
    return { valid: false, reason: 'args must be an array' };
  }
  for (const arg of args) {
    if (arg === undefined || arg === null) {
      return { valid: false, reason: 'args must not contain undefined or null' };
    }
    if (typeof arg !== 'string') {
      return { valid: false, reason: 'each arg must be a string' };
    }
    if (arg.length > 8192) {
      return { valid: false, reason: 'arg exceeds max length (8192)' };
    }
    if (DANGEROUS_ARG_PATTERN.test(arg)) {
      return { valid: false, reason: 'arg contains disallowed shell metacharacter' };
    }
  }
  return { valid: true };
}

/**
 * Safe spawn wrapper — enforces command allowlist, arg validation, shell:false.
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [opts]
 * @returns {import('node:child_process').ChildProcess}
 */
export function safeSpawn(cmd, args = [], opts = {}) {
  if (!isCommandAllowed(cmd)) {
    throw new Error(`Command not allowed: ${cmd}`);
  }

  const argCheck = validateArgs(args);
  if (!argCheck.valid) {
    throw new Error(`Invalid arguments: ${argCheck.reason}`);
  }

  return spawn(cmd, args, {
    ...opts,
    shell: false,
  });
}
