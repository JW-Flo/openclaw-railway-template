<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import Card from '$lib/components/shared/Card.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

  let indicators = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let refreshInterval;

  async function loadPosture() {
    try {
      const data = await api.get('/setup/api/security-posture');
      indicators = data.indicators || [];
      error = null;
    } catch (err) {
      error = err.body || err.message;
    } finally {
      loading = false;
    }
  }

  function statusColor(status) {
    if (status === 'green') return 'bg-success';
    if (status === 'amber') return 'bg-warning';
    return 'bg-danger';
  }

  function statusLabel(status) {
    if (status === 'green') return 'Secure';
    if (status === 'amber') return 'Warning';
    return 'Critical';
  }

  function statusVariant(status) {
    if (status === 'green') return 'success';
    if (status === 'amber') return 'warning';
    return 'danger';
  }

  let overallStatus = $derived(() => {
    if (indicators.length === 0) return 'unknown';
    const hasRed = indicators.some(i => i.status === 'red');
    const hasAmber = indicators.some(i => i.status === 'amber');
    if (hasRed) return 'critical';
    if (hasAmber) return 'warning';
    return 'secure';
  });

  onMount(() => {
    loadPosture();
    refreshInterval = setInterval(loadPosture, 30000);
    return () => clearInterval(refreshInterval);
  });
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-text">Security Posture</h1>
      <p class="text-sm text-text-3 mt-1">7 security indicators monitored in real-time</p>
    </div>
    <button
      class="px-3 py-1.5 text-sm bg-surface-2 hover:bg-surface-3 text-text-2 rounded-lg transition-colors"
      onclick={loadPosture}
    >
      Refresh
    </button>
  </div>

  {#if loading}
    <div class="flex justify-center py-12">
      <Spinner />
    </div>
  {:else if error}
    <Card>
      <p class="text-danger">{error}</p>
    </Card>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {#each indicators as indicator}
        <Card>
          <div class="flex items-start gap-3">
            <span
              class="w-3 h-3 rounded-full mt-1 flex-shrink-0 {statusColor(indicator.status)}"
              class:animate-pulse={indicator.status === 'red'}
            ></span>
            <div class="min-w-0">
              <p class="text-sm font-medium text-text">{indicator.label}</p>
              <p class="text-xs text-text-3 mt-0.5">{indicator.detail}</p>
              <div class="mt-2">
                <Badge variant={statusVariant(indicator.status)}>
                  {statusLabel(indicator.status)}
                </Badge>
              </div>
            </div>
          </div>
        </Card>
      {/each}
    </div>
  {/if}
</div>
