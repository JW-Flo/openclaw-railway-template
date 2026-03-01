/**
 * bootstrap-guard.js — Workspace bootstrap integrity verification
 *
 * Computes SHA-256 hashes of workspace template files and compares
 * them against a stored manifest to detect unauthorized modifications.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MANIFEST_FILENAME = "bootstrap-manifest.json";

/**
 * Compute SHA-256 hash of a file's contents.
 */
function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Recursively find all .md files in a directory.
 */
function findMarkdownFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Build a manifest of {relativePath: sha256Hash} for all .md files
 * in the workspace directory.
 */
function buildManifest(workspaceDir) {
  const files = findMarkdownFiles(workspaceDir);
  const manifest = {};
  for (const filePath of files) {
    const relPath = path.relative(workspaceDir, filePath);
    manifest[relPath] = hashFile(filePath);
  }
  return manifest;
}

/**
 * Read the stored manifest from the state directory.
 */
function readManifest(stateDir) {
  const manifestPath = path.join(stateDir, MANIFEST_FILENAME);
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Write the manifest to the state directory.
 */
function writeManifest(stateDir, manifest) {
  const manifestPath = path.join(stateDir, MANIFEST_FILENAME);
  const tmpPath = manifestPath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmpPath, manifestPath);
}

/**
 * Verify workspace files against stored manifest.
 * Returns { verified: bool, mismatches: [{file, expected, actual}], newFiles: [string], missingFiles: [string] }
 */
export function verifyBootstrap(stateDir, workspaceDir) {
  const stored = readManifest(stateDir);
  if (!stored) {
    return { verified: true, mismatches: [], newFiles: [], missingFiles: [], noManifest: true };
  }

  const current = buildManifest(workspaceDir);
  const mismatches = [];
  const missingFiles = [];
  const newFiles = [];

  // Check all files in stored manifest
  for (const [relPath, expectedHash] of Object.entries(stored)) {
    if (!(relPath in current)) {
      missingFiles.push(relPath);
    } else if (current[relPath] !== expectedHash) {
      mismatches.push({ file: relPath, expected: expectedHash, actual: current[relPath] });
    }
  }

  // Check for new files not in manifest
  for (const relPath of Object.keys(current)) {
    if (!(relPath in stored)) {
      newFiles.push(relPath);
    }
  }

  const verified = mismatches.length === 0 && missingFiles.length === 0;

  if (!verified) {
    console.error(`[SECURITY-ALERT] Bootstrap integrity check failed!`);
    for (const m of mismatches) {
      console.error(`[SECURITY-ALERT] Modified: ${m.file} (expected ${m.expected.slice(0, 12)}..., got ${m.actual.slice(0, 12)}...)`);
    }
    for (const f of missingFiles) {
      console.error(`[SECURITY-ALERT] Missing: ${f}`);
    }
  }

  return { verified, mismatches, newFiles, missingFiles, noManifest: false };
}

/**
 * Create or update the bootstrap manifest from the current workspace state.
 */
export function rebaselineManifest(stateDir, workspaceDir) {
  const manifest = buildManifest(workspaceDir);
  writeManifest(stateDir, manifest);
  console.log(`[bootstrap-guard] Manifest updated with ${Object.keys(manifest).length} files`);
  return manifest;
}

/**
 * Initialize bootstrap guard on boot:
 * - If no manifest exists, create one (first boot after this feature is deployed)
 * - If manifest exists, verify and report
 */
export function initBootstrapGuard(stateDir, workspaceDir) {
  const existing = readManifest(stateDir);
  if (!existing) {
    // First boot with bootstrap guard — create initial manifest
    console.log("[bootstrap-guard] No manifest found, creating initial baseline...");
    rebaselineManifest(stateDir, workspaceDir);
    return { verified: true, mismatches: [], newFiles: [], missingFiles: [], firstRun: true };
  }
  return verifyBootstrap(stateDir, workspaceDir);
}
