<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import Card from '$lib/components/shared/Card.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

  let summary = $state(null);
  let dailyData = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let days = $state(30);

  async function loadCosts() {
    loading = true;
    try {
      const [summaryRes, dailyRes] = await Promise.all([
        api.get('/setup/api/costs/summary'),
        api.get(`/setup/api/costs?days=${days}`),
      ]);
      summary = summaryRes;
      dailyData = dailyRes.aggregates || [];
      error = null;
    } catch (err) {
      error = err.body || err.message;
    } finally {
      loading = false;
    }
  }

  function formatCost(usd) {
    return `$${(usd || 0).toFixed(4)}`;
  }

  function formatTokens(n) {
    if (!n) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  let maxDailyCost = $derived(
    dailyData.length > 0
      ? Math.max(...dailyData.map(d => d.total_cost), 0.001)
      : 0.001
  );

  let modelEntries = $derived(
    summary?.by_model
      ? Object.entries(summary.by_model).sort((a, b) => b[1].cost - a[1].cost)
      : []
  );

  onMount(() => {
    loadCosts();
  });
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-text">Cost Dashboard</h1>
      <p class="text-sm text-text-3 mt-1">LLM usage costs and budget tracking</p>
    </div>
    <div class="flex items-center gap-2">
      <select
        class="px-2 py-1.5 text-sm bg-surface-2 text-text-2 rounded-lg border border-border"
        bind:value={days}
        onchange={loadCosts}
      >
        <option value={7}>7 days</option>
        <option value={14}>14 days</option>
        <option value={30}>30 days</option>
        <option value={90}>90 days</option>
      </select>
      <button
        class="px-3 py-1.5 text-sm bg-surface-2 hover:bg-surface-3 text-text-2 rounded-lg transition-colors"
        onclick={loadCosts}
      >
        Refresh
      </button>
    </div>
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
    <!-- Summary cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <p class="text-xs text-text-3 uppercase tracking-wider">Month Total</p>
        <p class="text-2xl font-bold text-text mt-1">{formatCost(summary?.total_cost)}</p>
        <p class="text-xs text-text-3 mt-1">{summary?.month}</p>
      </Card>
      <Card>
        <p class="text-xs text-text-3 uppercase tracking-wider">Requests</p>
        <p class="text-2xl font-bold text-text mt-1">{summary?.requests || 0}</p>
        <p class="text-xs text-text-3 mt-1">this month</p>
      </Card>
      <Card>
        <p class="text-xs text-text-3 uppercase tracking-wider">Input Tokens</p>
        <p class="text-2xl font-bold text-text mt-1">{formatTokens(summary?.total_input)}</p>
        <p class="text-xs text-text-3 mt-1">this month</p>
      </Card>
      <Card>
        <p class="text-xs text-text-3 uppercase tracking-wider">Output Tokens</p>
        <p class="text-2xl font-bold text-text mt-1">{formatTokens(summary?.total_output)}</p>
        <p class="text-xs text-text-3 mt-1">this month</p>
      </Card>
    </div>

    <!-- Daily chart (simple bar chart) -->
    {#if dailyData.length > 0}
      <Card>
        <h2 class="text-sm font-medium text-text mb-4">Daily Spend</h2>
        <div class="flex items-end gap-1 h-40">
          {#each dailyData as day}
            <div class="flex-1 flex flex-col items-center gap-1 min-w-0 group relative">
              <div
                class="w-full bg-accent/60 rounded-t hover:bg-accent transition-colors"
                style="height: {Math.max((day.total_cost / maxDailyCost) * 100, 2)}%"
              ></div>
              <!-- Tooltip -->
              <div class="absolute bottom-full mb-2 hidden group-hover:block bg-surface-3 text-text text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-10">
                {day.date}: {formatCost(day.total_cost)} ({day.requests} req)
              </div>
            </div>
          {/each}
        </div>
        <div class="flex justify-between mt-2 text-xs text-text-3">
          <span>{dailyData[0]?.date || ''}</span>
          <span>{dailyData[dailyData.length - 1]?.date || ''}</span>
        </div>
      </Card>
    {/if}

    <!-- Per-model breakdown -->
    {#if modelEntries.length > 0}
      <Card>
        <h2 class="text-sm font-medium text-text mb-4">Cost by Model</h2>
        <div class="space-y-3">
          {#each modelEntries as [model, data]}
            <div class="flex items-center justify-between">
              <div class="min-w-0">
                <p class="text-sm text-text truncate">{model}</p>
                <p class="text-xs text-text-3">{data.requests} requests</p>
              </div>
              <p class="text-sm font-medium text-text">{formatCost(data.cost)}</p>
            </div>
          {/each}
        </div>
      </Card>
    {/if}
  {/if}
</div>
