import { vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Mock child process returned by spawn.
 */
export function createMockChildProcess() {
  const cp = new EventEmitter();
  cp.stdout = new EventEmitter();
  cp.stderr = new EventEmitter();
  cp.pid = 12345;
  cp.kill = vi.fn();
  return cp;
}

/**
 * Mock spawn that returns a mock child process.
 */
export const spawn = vi.fn(() => createMockChildProcess());

export default { spawn };
