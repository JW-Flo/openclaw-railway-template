import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

/**
 * Compute SHA-256 hash of a file.
 * @param {string} filePath
 * @returns {string}
 */
export function hashFile(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Recursively walk a directory and return all file paths matching extensions.
 * @param {string} dir
 * @param {string[]} extensions
 * @returns {string[]}
 */
function walkDir(dir, extensions) {
  const results = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Compute a manifest of file hashes for a workspace directory.
 * @param {string} workspaceDir
 * @returns {Record<string, string>} — relative path → SHA-256 hash
 */
export function computeManifest(workspaceDir) {
  const files = walkDir(workspaceDir, ['.md', 'SKILL.md']);
  const manifest = {};
  for (const f of files) {
    const rel = relative(workspaceDir, f);
    manifest[rel] = hashFile(f);
  }
  return manifest;
}

/**
 * Save a manifest to disk.
 * @param {string} manifestPath
 * @param {Record<string, string>} manifest
 */
export function saveManifest(manifestPath, manifest) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Load a manifest from disk.
 * @param {string} manifestPath
 * @returns {Record<string, string> | null}
 */
export function loadManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Verify workspace integrity against a saved manifest.
 * @param {string} workspaceDir
 * @param {string} manifestPath
 * @returns {{ verified: boolean, mismatches: Array<{ file: string, expected: string, actual: string }> }}
 */
export function verifyIntegrity(workspaceDir, manifestPath) {
  const saved = loadManifest(manifestPath);
  if (!saved) {
    return { verified: false, mismatches: [{ file: '(manifest)', expected: 'exists', actual: 'missing' }] };
  }

  const current = computeManifest(workspaceDir);
  const mismatches = [];

  // Check saved files for changes or deletions
  for (const [file, expectedHash] of Object.entries(saved)) {
    const actualHash = current[file];
    if (actualHash !== expectedHash) {
      mismatches.push({ file, expected: expectedHash, actual: actualHash || 'deleted' });
    }
  }

  // Detect new files not in the original manifest
  for (const file of Object.keys(current)) {
    if (!(file in saved)) {
      mismatches.push({ file, expected: 'absent', actual: 'added' });
    }
  }

  return { verified: mismatches.length === 0, mismatches };
}

/**
 * Rebaseline: recompute and save a fresh manifest.
 * @param {string} workspaceDir
 * @param {string} manifestPath
 * @returns {Record<string, string>}
 */
export function rebaseline(workspaceDir, manifestPath) {
  const manifest = computeManifest(workspaceDir);
  saveManifest(manifestPath, manifest);
  return manifest;
}
