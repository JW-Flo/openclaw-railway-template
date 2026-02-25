import { writable } from 'svelte/store';
import { api } from '$lib/api/client.js';

export const user = writable(null);
export const authLoading = writable(true);
export const authMethod = writable(null);

export async function checkAuth() {
  authLoading.set(true);
  try {
    const res = await api.get('/setup/api/auth/me');
    if (res.ok && res.user) {
      user.set(res.user);
      authMethod.set(res.authMethod || 'session');
    } else {
      user.set(null);
    }
  } catch {
    // Not authenticated via session - may still work via Basic auth
    user.set(null);
  }
  authLoading.set(false);
}

export async function login(username, password) {
  const res = await api.post('/setup/api/auth/login', { username, password });
  if (res.ok && res.user) {
    user.set(res.user);
    authMethod.set('session');
    return res.user;
  }
  throw new Error(res.error || 'Login failed');
}

export async function logout() {
  try {
    await api.post('/setup/api/auth/logout');
  } catch { /* ok */ }
  user.set(null);
  authMethod.set(null);
}

export function hasPermission(userObj, permission) {
  if (!userObj) return false;
  const ROLE_LEVELS = {
    'limited-read': 1, 'read': 2, 'read-write': 3,
    'admin': 4, 'super-admin': 5, 'owner': 6,
  };
  const level = ROLE_LEVELS[userObj.role] || 0;
  // Owner can do everything
  if (level >= 6) return true;
  // Simple level checks
  const [action] = permission.split(':');
  if (action === 'view' && level >= 1) return true;
  if (action === 'edit' && level >= 3) return true;
  if (action === 'manage' && level >= 4) return true;
  if (action === 'admin' && level >= 5) return true;
  return false;
}
