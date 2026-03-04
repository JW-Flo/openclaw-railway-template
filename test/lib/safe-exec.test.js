import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isCommandAllowed, safeSpawn, CMD_ALLOWLIST } from '../../src/lib/safe-exec.js';

// Mock child_process.spawn so safeSpawn doesn't actually exec anything
vi.mock('node:child_process', async (importOriginal) => {
  const { EventEmitter } = await import('node:events');
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual,
      spawn: vi.fn(() => {
        const cp = new EventEmitter();
        cp.stdout = new EventEmitter();
        cp.stderr = new EventEmitter();
        cp.pid = 99999;
        cp.kill = vi.fn();
        return cp;
      }),
    },
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
      const disallowed = ['rm', 'sudo', 'chmod', 'chown', 'mkfs', 'dd'];
      for (const cmd of disallowed) {
        expect(isCommandAllowed(cmd)).toBe(false);
      }
    });

    it('rejects empty/null/undefined commands', () => {
      expect(isCommandAllowed('')).toBe(false);
      expect(isCommandAllowed(null)).toBe(false);
      expect(isCommandAllowed(undefined)).toBe(false);
    });

    it('resolves basename for path-based commands', () => {
      // isCommandAllowed extracts basename, so /usr/bin/git resolves to "git"
      expect(isCommandAllowed('/usr/bin/git')).toBe(true);
      expect(isCommandAllowed('/usr/bin/rm')).toBe(false);
    });
  });

  describe('safeSpawn', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('throws for disallowed commands', () => {
      expect(() => safeSpawn('rm', ['-rf', '/'])).toThrow('Command not allowed');
    });

    it('throws for non-string args', () => {
      expect(() => safeSpawn('git', [123])).toThrow('must be a string');
    });

    it('returns a child process for valid commands', async () => {
      const cp = safeSpawn('git', ['status']);
      expect(cp).toBeDefined();
      expect(cp.pid).toBe(99999);
    });

    it('forces shell:false even if opts.shell is true', async () => {
      const childProcess = (await import('node:child_process')).default;
      safeSpawn('git', ['log'], { shell: true, cwd: '/tmp' });
      expect(childProcess.spawn).toHaveBeenCalledWith('git', ['log'], { cwd: '/tmp', shell: false });
    });

    it('passes through valid openclaw args', async () => {
      const childProcess = (await import('node:child_process')).default;
      const args = ['gateway', 'run', '--port', '18789'];
      safeSpawn('openclaw', args);
      expect(childProcess.spawn).toHaveBeenCalledWith('openclaw', args, { shell: false });
    });
  });

  describe('CMD_ALLOWLIST', () => {
    it('exports the allowlist as a Set', () => {
      expect(CMD_ALLOWLIST).toBeInstanceOf(Set);
      expect(CMD_ALLOWLIST.has('git')).toBe(true);
      expect(CMD_ALLOWLIST.has('rm')).toBe(false);
    });
  });
});
