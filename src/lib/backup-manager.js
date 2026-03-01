import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { create as tarCreate, extract as tarExtract } from 'tar';

const MAX_LOCAL_BACKUPS = 10;
const MAX_REMOTE_BACKUPS = 30;

/**
 * Backup manager for OpenClaw state and workspace data.
 * Creates tar.gz archives with embedded SHA-256 manifests.
 */
export class BackupManager {
  #stateDir;
  #workspaceDir;
  #backupDir;
  #intervalHandle;

  /**
   * @param {string} stateDir — e.g. /data/.openclaw
   * @param {string} workspaceDir — e.g. /data/workspace
   * @param {string} [backupDir] — defaults to /data/backups
   */
  constructor(stateDir, workspaceDir, backupDir) {
    this.#stateDir = stateDir;
    this.#workspaceDir = workspaceDir;
    this.#backupDir = backupDir || join(stateDir, '..', 'backups');
  }

  get backupDir() {
    return this.#backupDir;
  }

  /**
   * Compute SHA-256 manifest of all files in a directory tree.
   * @param {string} dir
   * @returns {Record<string, string>} relative path → sha256 hex
   */
  #computeManifest(dir) {
    const manifest = {};
    if (!existsSync(dir)) return manifest;

    const walk = (current, prefix) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const fullPath = join(current, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          // Skip node_modules and .git to keep backups manageable
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          walk(fullPath, relPath);
        } else {
          const hash = createHash('sha256').update(readFileSync(fullPath)).digest('hex');
          manifest[relPath] = hash;
        }
      }
    };
    walk(dir, '');
    return manifest;
  }

  /**
   * Create a backup archive.
   * @returns {Promise<{ name: string, path: string, manifest: Record<string, string>, size: number }>}
   */
  async createBackup() {
    mkdirSync(this.#backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `backup-${timestamp}.tar.gz`;
    const archivePath = join(this.#backupDir, name);

    // Compute manifest before archiving
    const manifest = {
      state: this.#computeManifest(this.#stateDir),
      workspace: this.#computeManifest(this.#workspaceDir),
    };

    // Write manifest to a temp file inside state dir for inclusion
    const manifestPath = join(this.#stateDir, '.backup-manifest.json');
    mkdirSync(this.#stateDir, { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Determine which directories to include
    const dataDir = join(this.#stateDir, '..');
    const stateDirName = basename(this.#stateDir);
    const workspaceDirName = basename(this.#workspaceDir);

    const tarEntries = [];
    if (existsSync(this.#stateDir)) tarEntries.push(stateDirName);
    if (existsSync(this.#workspaceDir)) tarEntries.push(workspaceDirName);

    if (tarEntries.length === 0) {
      throw new Error('No data directories found to backup');
    }

    // Create tar.gz
    await tarCreate({
      gzip: true,
      file: archivePath,
      cwd: dataDir,
      filter: (filePath) => {
        // Skip node_modules and .git inside the archive
        if (filePath.includes('node_modules/') || filePath.includes('.git/')) return false;
        // Skip backup archives themselves
        if (filePath.includes('/backups/') && filePath.endsWith('.tar.gz')) return false;
        return true;
      },
    }, tarEntries);

    // Clean up temp manifest
    try { unlinkSync(manifestPath); } catch { /* ignore */ }

    // Rotate: keep only MAX_LOCAL_BACKUPS
    this.#rotateLocal();

    const size = statSync(archivePath).size;
    console.log(`[backup] created ${name} (${(size / 1024 / 1024).toFixed(1)} MB)`);

    return { name, path: archivePath, manifest, size };
  }

  /**
   * Verify a backup archive's integrity against its embedded manifest.
   * @param {string} archiveName
   * @returns {Promise<{ verified: boolean, errors: string[] }>}
   */
  async verifyBackup(archiveName) {
    const archivePath = join(this.#backupDir, archiveName);
    if (!existsSync(archivePath)) {
      return { verified: false, errors: ['Archive not found'] };
    }

    const errors = [];

    try {
      // Extract to a temp dir and verify
      const tmpDir = join(this.#backupDir, `.verify-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      await tarExtract({ file: archivePath, cwd: tmpDir });

      // Look for manifest
      const stateDirName = basename(this.#stateDir);
      const manifestPath = join(tmpDir, stateDirName, '.backup-manifest.json');
      if (!existsSync(manifestPath)) {
        errors.push('No manifest found in archive');
      } else {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

        // Verify state files
        for (const [relPath, expectedHash] of Object.entries(manifest.state || {})) {
          if (relPath === '.backup-manifest.json') continue;
          const filePath = join(tmpDir, stateDirName, relPath);
          if (!existsSync(filePath)) {
            errors.push(`Missing state file: ${relPath}`);
            continue;
          }
          const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex');
          if (actual !== expectedHash) {
            errors.push(`Hash mismatch: ${relPath}`);
          }
        }

        // Verify workspace files (sample check — full check would be slow)
        const wsEntries = Object.entries(manifest.workspace || {});
        const sampleSize = Math.min(wsEntries.length, 20);
        const workspaceDirName = basename(this.#workspaceDir);
        for (let i = 0; i < sampleSize; i++) {
          const [relPath, expectedHash] = wsEntries[i];
          const filePath = join(tmpDir, workspaceDirName, relPath);
          if (!existsSync(filePath)) {
            errors.push(`Missing workspace file: ${relPath}`);
            continue;
          }
          const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex');
          if (actual !== expectedHash) {
            errors.push(`Hash mismatch: workspace/${relPath}`);
          }
        }
      }

      // Clean up temp dir
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      errors.push(`Verification error: ${err.message}`);
    }

    return { verified: errors.length === 0, errors };
  }

  /**
   * Restore from a backup archive.
   * @param {string} archiveName
   * @returns {Promise<{ restored: boolean, errors: string[] }>}
   */
  async restoreBackup(archiveName) {
    // First verify integrity
    const { verified, errors } = await this.verifyBackup(archiveName);
    if (!verified) {
      return { restored: false, errors: [`Integrity check failed: ${errors.join(', ')}`] };
    }

    const archivePath = join(this.#backupDir, archiveName);
    const dataDir = join(this.#stateDir, '..');

    try {
      await tarExtract({ file: archivePath, cwd: dataDir });
      console.log(`[backup] restored from ${archiveName}`);
      return { restored: true, errors: [] };
    } catch (err) {
      return { restored: false, errors: [`Restore failed: ${err.message}`] };
    }
  }

  /**
   * List available local backups sorted newest first.
   * @returns {Array<{ name: string, size: number, created: string }>}
   */
  listBackups() {
    if (!existsSync(this.#backupDir)) return [];

    return readdirSync(this.#backupDir)
      .filter(f => f.startsWith('backup-') && f.endsWith('.tar.gz'))
      .map(name => {
        const stat = statSync(join(this.#backupDir, name));
        return {
          name,
          size: stat.size,
          created: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.created.localeCompare(a.created));
  }

  /**
   * Rotate local backups — keep only MAX_LOCAL_BACKUPS.
   */
  #rotateLocal() {
    const backups = this.listBackups();
    if (backups.length <= MAX_LOCAL_BACKUPS) return;

    const toDelete = backups.slice(MAX_LOCAL_BACKUPS);
    for (const b of toDelete) {
      try {
        unlinkSync(join(this.#backupDir, b.name));
        console.log(`[backup] rotated out ${b.name}`);
      } catch (err) {
        console.warn(`[backup] failed to delete ${b.name}: ${err.message}`);
      }
    }
  }

  /**
   * Upload backup to S3/R2 if configured.
   * @param {string} archiveName
   * @param {{ bucket: string, accessKeyId: string, secretAccessKey: string, endpoint?: string, region?: string }} s3Config
   * @returns {Promise<{ uploaded: boolean, key?: string, error?: string }>}
   */
  async uploadToS3(archiveName, s3Config) {
    const archivePath = join(this.#backupDir, archiveName);
    if (!existsSync(archivePath)) {
      return { uploaded: false, error: 'Archive not found' };
    }

    try {
      const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = await import('@aws-sdk/client-s3');

      const client = new S3Client({
        region: s3Config.region || 'auto',
        endpoint: s3Config.endpoint,
        credentials: {
          accessKeyId: s3Config.accessKeyId,
          secretAccessKey: s3Config.secretAccessKey,
        },
        forcePathStyle: true,
      });

      const key = `openclaw-backups/${archiveName}`;
      const body = readFileSync(archivePath);

      await client.send(new PutObjectCommand({
        Bucket: s3Config.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/gzip',
      }));

      // Rotate remote: keep MAX_REMOTE_BACKUPS
      const listResp = await client.send(new ListObjectsV2Command({
        Bucket: s3Config.bucket,
        Prefix: 'openclaw-backups/',
      }));

      const remoteFiles = (listResp.Contents || [])
        .filter(o => o.Key.endsWith('.tar.gz'))
        .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));

      if (remoteFiles.length > MAX_REMOTE_BACKUPS) {
        for (const old of remoteFiles.slice(MAX_REMOTE_BACKUPS)) {
          await client.send(new DeleteObjectCommand({
            Bucket: s3Config.bucket,
            Key: old.Key,
          }));
          console.log(`[backup] rotated remote: ${old.Key}`);
        }
      }

      console.log(`[backup] uploaded to s3://${s3Config.bucket}/${key}`);
      return { uploaded: true, key };
    } catch (err) {
      console.warn(`[backup] S3 upload failed: ${err.message}`);
      return { uploaded: false, error: err.message };
    }
  }

  /**
   * Get S3 config from environment variables.
   * @returns {{ bucket: string, accessKeyId: string, secretAccessKey: string, endpoint?: string, region?: string } | null}
   */
  static getS3Config() {
    const bucket = process.env.BACKUP_S3_BUCKET?.trim();
    const accessKeyId = process.env.BACKUP_S3_KEY?.trim();
    const secretAccessKey = process.env.BACKUP_S3_SECRET?.trim();
    if (!bucket || !accessKeyId || !secretAccessKey) return null;
    return {
      bucket,
      accessKeyId,
      secretAccessKey,
      endpoint: process.env.BACKUP_S3_ENDPOINT?.trim(),
      region: process.env.BACKUP_S3_REGION?.trim() || 'auto',
    };
  }

  /**
   * Schedule periodic backups.
   * @param {number} [intervalMinutes=60] — from BACKUP_INTERVAL_MINUTES env
   */
  scheduleBackups(intervalMinutes) {
    const interval = intervalMinutes || parseInt(process.env.BACKUP_INTERVAL_MINUTES || '60', 10);
    if (this.#intervalHandle) clearInterval(this.#intervalHandle);

    console.log(`[backup] scheduling backups every ${interval} minutes`);
    this.#intervalHandle = setInterval(async () => {
      try {
        const result = await this.createBackup();
        const s3Config = BackupManager.getS3Config();
        if (s3Config) {
          await this.uploadToS3(result.name, s3Config);
        }
      } catch (err) {
        console.error(`[backup] scheduled backup failed: ${err.message}`);
      }
    }, interval * 60 * 1000);
  }

  /**
   * Stop scheduled backups.
   */
  stopSchedule() {
    if (this.#intervalHandle) {
      clearInterval(this.#intervalHandle);
      this.#intervalHandle = null;
      console.log('[backup] stopped scheduled backups');
    }
  }
}
