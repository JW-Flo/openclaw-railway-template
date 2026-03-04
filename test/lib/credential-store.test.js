import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCredentialStore } from '../../src/lib/credential-store.js';

describe('CredentialStore', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cred-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('encrypts and decrypts a credential round-trip', () => {
    const store = createCredentialStore(tmpDir, 'mypassword');
    store.encrypt('OPENAI_KEY', 'sk-test-12345');
    const result = store.decrypt('OPENAI_KEY');
    expect(result).toBe('sk-test-12345');
  });

  it('returns null for non-existent key', () => {
    const store = createCredentialStore(tmpDir, 'pass');
    store.encrypt('KEY_A', 'value_a');
    const result = store.decrypt('KEY_B');
    expect(result).toBeNull();
  });

  it('fails to decrypt with wrong password', () => {
    const store = createCredentialStore(tmpDir, 'correctpassword');
    store.encrypt('SECRET', 'topsecret');
    const wrongStore = createCredentialStore(tmpDir, 'wrongpassword');
    expect(() => wrongStore.decrypt('SECRET')).toThrow();
  });

  it('re-encrypts with a new password', () => {
    const store = createCredentialStore(tmpDir, 'oldpass');
    store.encrypt('API_KEY', 'original-value');
    const newStore = store.reEncrypt('newpass');

    // New password should succeed
    const result = newStore.decrypt('API_KEY');
    expect(result).toBe('original-value');
  });

  it('lists stored key names', () => {
    const store = createCredentialStore(tmpDir, 'pass');
    store.encrypt('KEY_1', 'val1');
    store.encrypt('KEY_2', 'val2');
    store.encrypt('KEY_3', 'val3');
    const keys = store.listKeys();
    expect(keys).toEqual(expect.arrayContaining(['KEY_1', 'KEY_2', 'KEY_3']));
    expect(keys).toHaveLength(3);
  });

  it('handles empty store gracefully', () => {
    const store = createCredentialStore(tmpDir, 'anypass');
    const keys = store.listKeys();
    expect(keys).toEqual([]);
  });

  it('stores multiple credentials independently', () => {
    const store = createCredentialStore(tmpDir, 'pass');
    store.encrypt('KEY_A', 'aaa');
    store.encrypt('KEY_B', 'bbb');
    expect(store.decrypt('KEY_A')).toBe('aaa');
    expect(store.decrypt('KEY_B')).toBe('bbb');
  });

  it('overwrites existing key with new value', () => {
    const store = createCredentialStore(tmpDir, 'pass');
    store.encrypt('KEY', 'original');
    store.encrypt('KEY', 'updated');
    expect(store.decrypt('KEY')).toBe('updated');
  });
});
