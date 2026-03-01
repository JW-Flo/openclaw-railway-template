import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BackupManager } from '../../src/lib/backup-manager.js';

describe('BackupManager', () => {
  let tmpDir;
  let stateDir;
  let workspaceDir;
  let backupDir;
  let manager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'backup-test-'));
    stateDir = join(tmpDir, '.openclaw');
    workspaceDir = join(tmpDir, 'workspace');
    backupDir = join(tmpDir, 'backups');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });

    // Create some test files
    writeFileSync(join(stateDir, 'openclaw.json'), '{"test": true}');
    writeFileSync(join(stateDir, 'gateway.token'), 'test-token-12345');
    writeFileSync(join(workspaceDir, 'IDENTITY.md'), '# Test Identity');
    writeFileSync(join(workspaceDir, 'MEMORY.md'), '# Test Memory');
    mkdirSync(join(workspaceDir, 'skills', 'test-skill'), { recursive: true });
    writeFileSync(join(workspaceDir, 'skills', 'test-skill', 'SKILL.md'), '# Test Skill');

    manager = new BackupManager(stateDir, workspaceDir, backupDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a backup archive', async () => {
    const result = await manager.createBackup();
    expect(result.name).toMatch(/^backup-.*\.tar\.gz$/);
    expect(result.size).toBeGreaterThan(0);
    expect(result.manifest).toBeDefined();
    expect(result.manifest.state).toBeDefined();
    expect(result.manifest.workspace).toBeDefined();
    expect(existsSync(result.path)).toBe(true);
  });

  it('manifest includes all files', async () => {
    const result = await manager.createBackup();
    expect(result.manifest.state['openclaw.json']).toBeDefined();
    expect(result.manifest.state['gateway.token']).toBeDefined();
    expect(result.manifest.workspace['IDENTITY.md']).toBeDefined();
    expect(result.manifest.workspace['MEMORY.md']).toBeDefined();
    expect(result.manifest.workspace['skills/test-skill/SKILL.md']).toBeDefined();
  });

  it('lists backups sorted newest first', async () => {
    await manager.createBackup();
    // Small delay to ensure different timestamps
    await new Promise(r => setTimeout(r, 50));
    await manager.createBackup();

    const backups = manager.listBackups();
    expect(backups.length).toBe(2);
    expect(new Date(backups[0].created).getTime()).toBeGreaterThanOrEqual(
      new Date(backups[1].created).getTime()
    );
  });

  it('rotates backups keeping only 10', async () => {
    // Create 12 backups
    for (let i = 0; i < 12; i++) {
      await manager.createBackup();
    }

    const backups = manager.listBackups();
    expect(backups.length).toBeLessThanOrEqual(10);
  });

  it('verifies a valid backup', async () => {
    const result = await manager.createBackup();
    const verification = await manager.verifyBackup(result.name);
    expect(verification.verified).toBe(true);
    expect(verification.errors).toHaveLength(0);
  });

  it('rejects verification for nonexistent archive', async () => {
    const verification = await manager.verifyBackup('nonexistent.tar.gz');
    expect(verification.verified).toBe(false);
    expect(verification.errors).toContain('Archive not found');
  });

  it('restores from a valid backup', async () => {
    const result = await manager.createBackup();

    // Modify state file
    writeFileSync(join(stateDir, 'openclaw.json'), '{"modified": true}');

    // Restore
    const restore = await manager.restoreBackup(result.name);
    expect(restore.restored).toBe(true);
    expect(restore.errors).toHaveLength(0);

    // Verify state was restored
    const restored = readFileSync(join(stateDir, 'openclaw.json'), 'utf8');
    expect(restored).toContain('"test"');
  });

  it('rejects restore of corrupted archive', async () => {
    // Create a fake corrupted archive
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, 'backup-corrupted.tar.gz'), 'not a valid archive');

    const result = await manager.restoreBackup('backup-corrupted.tar.gz');
    expect(result.restored).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns empty list when no backups exist', () => {
    const backups = manager.listBackups();
    expect(backups).toEqual([]);
  });

  it('getS3Config returns null when env vars missing', () => {
    delete process.env.BACKUP_S3_BUCKET;
    delete process.env.BACKUP_S3_KEY;
    delete process.env.BACKUP_S3_SECRET;
    const config = BackupManager.getS3Config();
    expect(config).toBeNull();
  });

  it('getS3Config returns config when env vars set', () => {
    process.env.BACKUP_S3_BUCKET = 'test-bucket';
    process.env.BACKUP_S3_KEY = 'AKIA12345';
    process.env.BACKUP_S3_SECRET = 'secret123';
    const config = BackupManager.getS3Config();
    expect(config).toEqual({
      bucket: 'test-bucket',
      accessKeyId: 'AKIA12345',
      secretAccessKey: 'secret123',
      endpoint: undefined,
      region: 'auto',
    });
    // Clean up
    delete process.env.BACKUP_S3_BUCKET;
    delete process.env.BACKUP_S3_KEY;
    delete process.env.BACKUP_S3_SECRET;
  });

  it('scheduleBackups and stopSchedule work', () => {
    manager.scheduleBackups(999); // Long interval so it doesn't fire
    // Should not throw
    manager.stopSchedule();
  });

  it('skips node_modules and .git in manifests', async () => {
    mkdirSync(join(workspaceDir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(workspaceDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}');
    mkdirSync(join(workspaceDir, '.git', 'refs'), { recursive: true });
    writeFileSync(join(workspaceDir, '.git', 'HEAD'), 'ref: refs/heads/main');

    const result = await manager.createBackup();
    const wsFiles = Object.keys(result.manifest.workspace);
    expect(wsFiles.every(f => !f.startsWith('node_modules/'))).toBe(true);
    expect(wsFiles.every(f => !f.startsWith('.git/'))).toBe(true);
  });
});
