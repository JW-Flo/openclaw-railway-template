import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  verifyBootstrap,
  rebaselineManifest,
  initBootstrapGuard,
} from '../../src/lib/bootstrap-guard.js';

describe('bootstrap-guard', () => {
  let tmpDir;
  let workspaceDir;
  let stateDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bootstrap-test-'));
    workspaceDir = join(tmpDir, 'workspace');
    stateDir = join(tmpDir, 'state');
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initBootstrapGuard creates manifest on first run', () => {
    writeFileSync(join(workspaceDir, 'IDENTITY.md'), '# Identity');
    const result = initBootstrapGuard(stateDir, workspaceDir);
    expect(result.verified).toBe(true);
    expect(result.firstRun).toBe(true);
  });

  it('rebaselineManifest scans .md files', () => {
    writeFileSync(join(workspaceDir, 'IDENTITY.md'), '# Identity');
    writeFileSync(join(workspaceDir, 'MEMORY.md'), '# Memory');
    writeFileSync(join(workspaceDir, 'other.txt'), 'not included');

    const manifest = rebaselineManifest(stateDir, workspaceDir);
    expect(Object.keys(manifest)).toContain('IDENTITY.md');
    expect(Object.keys(manifest)).toContain('MEMORY.md');
    expect(Object.keys(manifest)).not.toContain('other.txt');
  });

  it('rebaselineManifest scans nested SKILL.md files', () => {
    const skillDir = join(workspaceDir, 'skills', 'deploy');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Deploy Skill');

    const manifest = rebaselineManifest(stateDir, workspaceDir);
    expect(Object.keys(manifest)).toContain(join('skills', 'deploy', 'SKILL.md'));
  });

  it('verifyBootstrap passes when files are unchanged', () => {
    writeFileSync(join(workspaceDir, 'SOUL.md'), '# Soul');
    rebaselineManifest(stateDir, workspaceDir);

    const result = verifyBootstrap(stateDir, workspaceDir);
    expect(result.verified).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('verifyBootstrap detects tampered files', () => {
    const soulPath = join(workspaceDir, 'SOUL.md');
    writeFileSync(soulPath, '# Original Soul');
    rebaselineManifest(stateDir, workspaceDir);

    // Tamper
    writeFileSync(soulPath, '# Tampered Soul');

    const result = verifyBootstrap(stateDir, workspaceDir);
    expect(result.verified).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.mismatches[0].file).toBe('SOUL.md');
  });

  it('verifyBootstrap detects deleted files', () => {
    const filePath = join(workspaceDir, 'TOOLS.md');
    writeFileSync(filePath, '# Tools');
    rebaselineManifest(stateDir, workspaceDir);

    rmSync(filePath);

    const result = verifyBootstrap(stateDir, workspaceDir);
    expect(result.verified).toBe(false);
    expect(result.missingFiles).toContain('TOOLS.md');
  });

  it('verifyBootstrap returns verified true when no manifest exists', () => {
    const result = verifyBootstrap(join(tmpDir, 'nope'), workspaceDir);
    expect(result.verified).toBe(true);
    expect(result.noManifest).toBe(true);
  });

  it('verifyBootstrap detects new untracked files', () => {
    writeFileSync(join(workspaceDir, 'SOUL.md'), '# Soul');
    rebaselineManifest(stateDir, workspaceDir);

    // Add a new file after baselining
    writeFileSync(join(workspaceDir, 'EVIL.md'), '# Injected');

    const result = verifyBootstrap(stateDir, workspaceDir);
    expect(result.newFiles).toContain('EVIL.md');
  });

  it('rebaselineManifest updates manifest correctly', () => {
    writeFileSync(join(workspaceDir, 'A.md'), 'v1');
    rebaselineManifest(stateDir, workspaceDir);

    writeFileSync(join(workspaceDir, 'A.md'), 'v2');
    rebaselineManifest(stateDir, workspaceDir);

    const result = verifyBootstrap(stateDir, workspaceDir);
    expect(result.verified).toBe(true);
  });
});
