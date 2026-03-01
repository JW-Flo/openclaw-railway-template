/**
 * credential-store.js — Encrypted credential storage
 *
 * AES-256-GCM encryption with PBKDF2-derived key.
 * Credentials stored in a single encrypted blob at /data/.openclaw/credentials.enc.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SALT_FILENAME = ".credential-salt";
const STORE_FILENAME = "credentials.enc";
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;

/**
 * Get or create the salt for key derivation.
 */
function getSalt(stateDir) {
  const saltPath = path.join(stateDir, SALT_FILENAME);
  try {
    return Buffer.from(fs.readFileSync(saltPath, "utf8").trim(), "hex");
  } catch {
    const salt = crypto.randomBytes(32);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(saltPath, salt.toString("hex"), { mode: 0o600 });
    return salt;
  }
}

/**
 * Derive an AES-256 key from a password using PBKDF2.
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns Buffer: [IV (12 bytes)][authTag (16 bytes)][ciphertext]
 */
function encryptBuffer(key, plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt an AES-256-GCM encrypted buffer.
 */
function decryptBuffer(key, data) {
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, null, "utf8") + decipher.final("utf8");
}

/**
 * Read the encrypted credential store. Returns a plain object or empty object.
 */
function readStore(stateDir, key) {
  const storePath = path.join(stateDir, STORE_FILENAME);
  try {
    const raw = fs.readFileSync(storePath);
    const json = decryptBuffer(key, raw);
    return JSON.parse(json);
  } catch (err) {
    // Only treat "file not found" as empty store; re-throw to prevent silent data loss
    if (err?.code === "ENOENT") return {};
    throw err;
  }
}

/**
 * Write the credential store (encrypt and persist).
 */
function writeStore(stateDir, key, data) {
  const storePath = path.join(stateDir, STORE_FILENAME);
  const tmpPath = storePath + ".tmp";
  const encrypted = encryptBuffer(key, JSON.stringify(data));
  fs.writeFileSync(tmpPath, encrypted, { mode: 0o600 });
  fs.renameSync(tmpPath, storePath);
}

/**
 * Create a CredentialStore instance bound to a specific state directory and password.
 */
export function createCredentialStore(stateDir, password) {
  const salt = getSalt(stateDir);
  const key = deriveKey(password, salt);

  return {
    /**
     * Store a credential under a key name.
     */
    encrypt(name, value) {
      const store = readStore(stateDir, key);
      store[name] = value;
      writeStore(stateDir, key, store);
    },

    /**
     * Retrieve a credential by key name. Returns null if not found.
     */
    decrypt(name) {
      const store = readStore(stateDir, key);
      return store[name] ?? null;
    },

    /**
     * List all stored credential key names.
     */
    listKeys() {
      const store = readStore(stateDir, key);
      return Object.keys(store);
    },

    /**
     * Re-encrypt the entire store with a new password.
     */
    reEncrypt(newPassword) {
      const store = readStore(stateDir, key);
      const newSalt = crypto.randomBytes(32);
      const saltPath = path.join(stateDir, SALT_FILENAME);
      fs.writeFileSync(saltPath, newSalt.toString("hex"), { mode: 0o600 });
      const newKey = deriveKey(newPassword, newSalt);
      writeStore(stateDir, newKey, store);
      // Return a new store bound to the new key
      return createCredentialStore(stateDir, newPassword);
    },

    /**
     * Check if the store has any credentials.
     */
    hasCredentials() {
      const storePath = path.join(stateDir, STORE_FILENAME);
      return fs.existsSync(storePath);
    },
  };
}

/**
 * Timing-safe password comparison using SHA-256 hashing + timingSafeEqual.
 */
export function safePasswordCompare(input, expected) {
  if (!input || !expected) return false;
  const inputHash = crypto.createHash("sha256").update(input).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(inputHash, expectedHash);
}
