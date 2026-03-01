import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives an AES-256 key from a password and salt using PBKDF2.
 */
function deriveKey(password, salt) {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

export class CredentialStore {
  #storeDir;
  #blobPath;
  #saltPath;

  /**
   * @param {string} storeDir — directory for credentials.enc and .credential-salt
   */
  constructor(storeDir) {
    this.#storeDir = storeDir;
    this.#blobPath = join(storeDir, 'credentials.enc');
    this.#saltPath = join(storeDir, '.credential-salt');
  }

  /**
   * Get or create the salt file.
   * @returns {Buffer}
   */
  #getSalt() {
    if (existsSync(this.#saltPath)) {
      return readFileSync(this.#saltPath);
    }
    mkdirSync(this.#storeDir, { recursive: true, mode: 0o700 });
    const salt = randomBytes(SALT_LENGTH);
    writeFileSync(this.#saltPath, salt, { mode: 0o600 });
    return salt;
  }

  /**
   * Load the encrypted blob and decrypt it.
   * @param {string} password
   * @returns {Record<string, string>}
   */
  #load(password) {
    if (!existsSync(this.#blobPath)) {
      return {};
    }
    const raw = readFileSync(this.#blobPath);
    if (raw.length === 0) return {};

    const salt = this.#getSalt();
    const key = deriveKey(password, salt);

    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  /**
   * Encrypt and write the store to disk.
   * @param {string} password
   * @param {Record<string, string>} data
   */
  #save(password, data) {
    const salt = this.#getSalt();
    const key = deriveKey(password, salt);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    mkdirSync(this.#storeDir, { recursive: true, mode: 0o700 });
    const blob = Buffer.concat([iv, authTag, ciphertext]);
    writeFileSync(this.#blobPath, blob, { mode: 0o600 });
  }

  /**
   * Encrypt and store a credential.
   * @param {string} credKey
   * @param {string} value
   * @param {string} password
   */
  encrypt(credKey, value, password) {
    const data = this.#load(password);
    data[credKey] = value;
    this.#save(password, data);
  }

  /**
   * Decrypt and retrieve a credential.
   * @param {string} credKey
   * @param {string} password
   * @returns {string | undefined}
   */
  decrypt(credKey, password) {
    const data = this.#load(password);
    return data[credKey];
  }

  /**
   * List all stored credential key names.
   * @param {string} password
   * @returns {string[]}
   */
  listKeys(password) {
    const data = this.#load(password);
    return Object.keys(data);
  }

  /**
   * Re-encrypt all credentials with a new password.
   * @param {string} oldPassword
   * @param {string} newPassword
   */
  reEncrypt(oldPassword, newPassword) {
    const data = this.#load(oldPassword);
    // Generate a new salt for the new password
    const newSalt = randomBytes(SALT_LENGTH);
    writeFileSync(this.#saltPath, newSalt);
    this.#save(newPassword, data);
  }
}
