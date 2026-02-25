import { writable } from 'svelte/store';
import { api } from '$lib/api/client.js';

export const health = writable(null);
export const healthLoading = writable(false);
export const connection = writable({ connected: false, gateway: false, uptime: 0, memory: 0 });

let pollInterval;

export async function loadHealth() {
  healthLoading.set(true);
  try {
    const data = await api.get('/setup/healthz');
    // Normalize: /setup/healthz returns gatewayRunning (bool) + gatewayStarting (bool)
    if (data && !data.gateway) {
      data.gateway = data.gatewayRunning ? 'running'
        : data.gatewayStarting ? 'starting'
        : 'stopped';
    }
    health.set(data);
  } catch {
    health.set(null);
  } finally {
    healthLoading.set(false);
  }
}

export async function loadConnection() {
  try {
    const data = await api.get('/setup/api/connection');
    connection.set({
      connected: data.connected || false,
      gateway: data.gateway || false,
      uptime: data.uptime || 0,
      memory: data.memory || 0,
      timestamp: data.timestamp,
    });
  } catch {
    connection.set({ connected: false, gateway: false, uptime: 0, memory: 0 });
  }
}

export function startHealthPolling(ms = 30000) {
  loadHealth();
  loadConnection();
  pollInterval = setInterval(() => {
    loadHealth();
    loadConnection();
  }, ms);
}

export function stopHealthPolling() {
  clearInterval(pollInterval);
}
