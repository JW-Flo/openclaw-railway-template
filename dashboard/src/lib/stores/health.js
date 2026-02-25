import { writable } from 'svelte/store';
import { api } from '$lib/api/client.js';

export const health = writable(null);
export const healthLoading = writable(false);

let pollInterval;

export async function loadHealth() {
  healthLoading.set(true);
  try {
    const data = await api.get('/setup/healthz');
    // Normalize: /setup/healthz returns gatewayRunning (bool) + gatewayStarting (bool)
    // Convert to a simpler gateway status string for components
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

export function startHealthPolling(ms = 30000) {
  loadHealth();
  pollInterval = setInterval(loadHealth, ms);
}

export function stopHealthPolling() {
  clearInterval(pollInterval);
}
