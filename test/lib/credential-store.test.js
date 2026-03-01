import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CredentialStore } from '../../src/lib/credential-store.js';

describe('CredentialStore', () => {
  let tmpDir;
  let store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cred-test-'));
    store = new CredentialStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('encrypts and decrypts a credential round-trip', () => {
    store.encrypt('OPENAI_KEY', 'sk-test-12345', 'mypassword');
    const result = store.decrypt('OPENAI_KEY', 'mypassword');
    expect(result).toBe('sk-test-12345');
  });

  it('returns undefined for non-existent key', () => {
    store.encrypt('KEY_A', 'value_a', 'pass');
    const result = store.decrypt('KEY_B', 'pass');
    expect(result).toBeUndefined();
  });

  it('fails to decrypt with wrong password', () => {
    store.encrypt('SECRET', 'topsecret', 'correctpassword');
    expect(() => store.decrypt('SECRET', 'wrongpassword')).toThrow();
  });

  it('re-encrypts with a new password', () => {
    store.encrypt('API_KEY', 'original-value', 'oldpass');
    store.reEncrypt('oldpass', 'newpass');

    // Old password should fail
    expect(() => store.decrypt('API_KEY', 'oldpass')).toThrow();

    // New password should succeed
    const result = store.decrypt('API_KEY', 'newpass');
    expect(result).toBe('original-value');
  });

  it('lists stored key names', () => {
    store.encrypt('KEY_1', 'val1', 'pass');
    store.encrypt('KEY_2', 'val2', 'pass');
    store.encrypt('KEY_3', 'val3', 'pass');
    const keys = store.listKeys('pass');
    expect(keys).toEqual(expect.arrayContaining(['KEY_1', 'KEY_2', 'KEY_3']));
    expect(keys).toHaveLength(3);
  });

  it('handles empty store gracefully', () => {
    const keys = store.listKeys('anypass');
    expect(keys).toEqual([]);
  });

  it('stores multiple credentials independently', () => {
    store.encrypt('KEY_A', 'aaa', 'pass');
    store.encrypt('KEY_B', 'bbb', 'pass');
    expect(store.decrypt('KEY_A', 'pass')).toBe('aaa');
    expect(store.decrypt('KEY_B', 'pass')).toBe('bbb');
  });

  it('overwrites existing key with new value', () => {
    store.encrypt('KEY', 'original', 'pass');
    store.encrypt('KEY', 'updated', 'pass');
    expect(store.decrypt('KEY', 'pass')).toBe('updated');
  });
});
