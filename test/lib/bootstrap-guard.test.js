import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  hashFile,
  computeManifest,
  saveManifest,
  loadManifest,
  verifyIntegrity,
  rebaseline,
} from '../../src/lib/bootstrap-guard.js';

describe('bootstrap-guard', () => {
  let tmpDir;
  let workspaceDir;
  let manifestPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bootstrap-test-'));
    workspaceDir = join(tmpDir, 'workspace');
    manifestPath = join(tmpDir, 'state', 'bootstrap-manifest.json');
    mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('hashFile returns consistent SHA-256', () => {
    const filePath = join(tmpDir, 'test.md');
    writeFileSync(filePath, 'hello world');
    const hash1 = hashFile(filePath);
    const hash2 = hashFile(filePath);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it('computeManifest scans .md files', () => {
    writeFileSync(join(workspaceDir, 'IDENTITY.md'), '# Identity');
    writeFileSync(join(workspaceDir, 'MEMORY.md'), '# Memory');
    writeFileSync(join(workspaceDir, 'other.txt'), 'not included');

    const manifest = computeManifest(workspaceDir);
    expect(Object.keys(manifest)).toContain('IDENTITY.md');
    expect(Object.keys(manifest)).toContain('MEMORY.md');
    expect(Object.keys(manifest)).not.toContain('other.txt');
  });

  it('computeManifest scans nested SKILL.md files', () => {
    const skillDir = join(workspaceDir, 'skills', 'deploy');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Deploy Skill');

    const manifest = computeManifest(workspaceDir);
    expect(Object.keys(manifest)).toContain(join('skills', 'deploy', 'SKILL.md'));
  });

  it('saveManifest and loadManifest round-trip', () => {
    const manifest = { 'file.md': 'abc123', 'sub/file.md': 'def456' };
    saveManifest(manifestPath, manifest);
    const loaded = loadManifest(manifestPath);
    expect(loaded).toEqual(manifest);
  });

  it('loadManifest returns null for missing file', () => {
    const result = loadManifest(join(tmpDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('verifyIntegrity passes when files are unchanged', () => {
    writeFileSync(join(workspaceDir, 'SOUL.md'), '# Soul');
    rebaseline(workspaceDir, manifestPath);

    const result = verifyIntegrity(workspaceDir, manifestPath);
    expect(result.verified).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('verifyIntegrity detects tampered files', () => {
    const soulPath = join(workspaceDir, 'SOUL.md');
    writeFileSync(soulPath, '# Original Soul');
    rebaseline(workspaceDir, manifestPath);

    // Tamper
    writeFileSync(soulPath, '# Tampered Soul');

    const result = verifyIntegrity(workspaceDir, manifestPath);
    expect(result.verified).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.mismatches[0].file).toBe('SOUL.md');
  });

  it('verifyIntegrity detects deleted files', () => {
    const filePath = join(workspaceDir, 'TOOLS.md');
    writeFileSync(filePath, '# Tools');
    rebaseline(workspaceDir, manifestPath);

    rmSync(filePath);

    const result = verifyIntegrity(workspaceDir, manifestPath);
    expect(result.verified).toBe(false);
    expect(result.mismatches.some((m) => m.actual === 'deleted')).toBe(true);
  });

  it('verifyIntegrity returns mismatch when manifest is missing', () => {
    const result = verifyIntegrity(workspaceDir, join(tmpDir, 'nope.json'));
    expect(result.verified).toBe(false);
    expect(result.mismatches[0].file).toBe('(manifest)');
  });

  it('verifyIntegrity detects new untracked files', () => {
    writeFileSync(join(workspaceDir, 'SOUL.md'), '# Soul');
    rebaseline(workspaceDir, manifestPath);

    // Add a new file after baselining
    writeFileSync(join(workspaceDir, 'EVIL.md'), '# Injected');

    const result = verifyIntegrity(workspaceDir, manifestPath);
    expect(result.verified).toBe(false);
    expect(result.mismatches.some((m) => m.file === 'EVIL.md' && m.actual === 'added')).toBe(true);
  });

  it('rebaseline updates manifest correctly', () => {
    writeFileSync(join(workspaceDir, 'A.md'), 'v1');
    rebaseline(workspaceDir, manifestPath);

    writeFileSync(join(workspaceDir, 'A.md'), 'v2');
    rebaseline(workspaceDir, manifestPath);

    const result = verifyIntegrity(workspaceDir, manifestPath);
    expect(result.verified).toBe(true);
  });
});
