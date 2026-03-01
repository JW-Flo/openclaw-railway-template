import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isCommandAllowed, validateArgs, safeSpawn } from '../../src/lib/safe-exec.js';

// Mock child_process.spawn so safeSpawn doesn't actually exec anything
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    spawn: vi.fn(() => {
      const cp = new EventEmitter();
      cp.stdout = new EventEmitter();
      cp.stderr = new EventEmitter();
      cp.pid = 99999;
      cp.kill = vi.fn();
      return cp;
    }),
  };
});

describe('safe-exec', () => {
  describe('isCommandAllowed', () => {
    it('allows whitelisted commands', () => {
      const allowed = ['openclaw', 'git', 'node', 'ls', 'grep', 'cat', 'df'];
      for (const cmd of allowed) {
        expect(isCommandAllowed(cmd)).toBe(true);
      }
    });

    it('rejects disallowed commands', () => {
      const disallowed = ['rm', 'curl', 'wget', 'python', 'bash', 'sh', 'sudo', 'chmod'];
      for (const cmd of disallowed) {
        expect(isCommandAllowed(cmd)).toBe(false);
      }
    });

    it('rejects empty/null/undefined commands', () => {
      expect(isCommandAllowed('')).toBe(false);
      expect(isCommandAllowed(null)).toBe(false);
      expect(isCommandAllowed(undefined)).toBe(false);
    });

    it('extracts basename from full path', () => {
      expect(isCommandAllowed('/usr/bin/git')).toBe(true);
      expect(isCommandAllowed('/usr/local/bin/node')).toBe(true);
      expect(isCommandAllowed('/bin/rm')).toBe(false);
    });
  });

  describe('validateArgs', () => {
    it('accepts clean args', () => {
      const result = validateArgs(['--version', 'config', 'get', 'key']);
      expect(result.valid).toBe(true);
    });

    it('rejects args with semicolons', () => {
      const result = validateArgs(['--flag; rm -rf /']);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('disallowed character');
    });

    it('rejects args with pipe', () => {
      const result = validateArgs(['foo | bar']);
      expect(result.valid).toBe(false);
    });

    it('rejects args with ampersand', () => {
      const result = validateArgs(['foo & bar']);
      expect(result.valid).toBe(false);
    });

    it('rejects args with dollar sign (variable expansion)', () => {
      const result = validateArgs(['$HOME']);
      expect(result.valid).toBe(false);
    });

    it('rejects args with backtick (command substitution)', () => {
      const result = validateArgs(['`whoami`']);
      expect(result.valid).toBe(false);
    });

    it('rejects args with backslash', () => {
      const result = validateArgs(['foo\\bar']);
      expect(result.valid).toBe(false);
    });

    it('rejects non-array args', () => {
      const result = validateArgs('not-an-array');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('args must be an array');
    });

    it('rejects undefined/null items in args', () => {
      expect(validateArgs([undefined]).valid).toBe(false);
      expect(validateArgs([null]).valid).toBe(false);
    });

    it('rejects very long args', () => {
      const longArg = 'x'.repeat(9000);
      const result = validateArgs([longArg]);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('max length');
    });

    it('accepts empty args array', () => {
      expect(validateArgs([]).valid).toBe(true);
    });
  });

  describe('safeSpawn', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('throws for disallowed commands', () => {
      expect(() => safeSpawn('rm', ['-rf', '/'])).toThrow('Command not allowed: rm');
    });

    it('throws for invalid args', () => {
      expect(() => safeSpawn('git', ['; rm -rf /'])).toThrow('Invalid arguments');
    });

    it('returns a child process for valid commands', async () => {
      const { spawn } = await import('node:child_process');
      const cp = safeSpawn('git', ['status']);
      expect(spawn).toHaveBeenCalledWith('git', ['status'], { shell: false });
      expect(cp).toBeDefined();
      expect(cp.pid).toBe(99999);
    });

    it('forces shell:false even if opts.shell is true', async () => {
      const { spawn } = await import('node:child_process');
      safeSpawn('git', ['log'], { shell: true, cwd: '/tmp' });
      expect(spawn).toHaveBeenCalledWith('git', ['log'], { cwd: '/tmp', shell: false });
    });

    it('passes through valid openclaw args', async () => {
      const { spawn } = await import('node:child_process');
      const args = ['gateway', 'run', '--port', '18789'];
      safeSpawn('openclaw', args);
      expect(spawn).toHaveBeenCalledWith('openclaw', args, { shell: false });
    });
  });
});
