<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { health } from '$lib/stores/health.js';
  import { error } from '$lib/stores/notifications.js';
  import Card from '$lib/components/shared/Card.svelte';
  import StatusDot from '$lib/components/shared/StatusDot.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';
  import CodeOutput from '$lib/components/shared/CodeOutput.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';

  let loading = $state(true);

  // Data from health store (auto-refreshed every 30s)
  let gatewayStatus = $derived($health?.gateway || 'unknown');
  let configured = $derived($health?.configured ?? false);
  let gatewayColor = $derived(
    gatewayStatus === 'running' ? 'green'
      : gatewayStatus === 'starting' ? 'yellow'
      : 'red'
  );

  // Data from API calls
  let currentModel = $state('');
  let projectCount = $state(0);
  let projectsDirty = $state(0);
  let openclawVersion = $state('');
  let credentialCount = $state(0);
  let credentialTotal = $state(0);
  let gatewayLogs = $state('');
  let sessionCount = $state(0);
  let taskQueueCount = $state(0);
  let cronJobCount = $state(0);
  let telegramEnabled = $state(false);
  let telegramStatus = $state('unknown');

  const TRACKED_CREDENTIALS = [
    'GH_PAT', 'OPENROUTER_API_TOKEN', 'ANTHROPIC_API_KEY',
    'CLOUDFLARE_ACCOUNT_ID', 'RAILWAY_ACCOUNT_TOKEN',
    'TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'GROK_API_KEY',
  ];

  function parseCredentials(envOutput) {
    if (!envOutput) return 0;
    const lines = typeof envOutput === 'string' ? envOutput : '';
    let count = 0;
    for (const name of TRACKED_CREDENTIALS) {
      if (lines.includes(name + '=')) count++;
    }
    return count;
  }

  async function loadData() {
    loading = true;
    try {
      const results = await Promise.allSettled([
        api.get('/setup/api/status'),
        api.get('/setup/api/models/current'),
        api.get('/setup/api/projects/status'),
        api.get('/setup/api/debug'),
        api.post('/setup/api/shell', { command: 'env' }),
        api.get('/setup/api/runner/queue'),
        api.post('/setup/api/openclaw-cmd', { args: ['sessions', '--json'] }),
        api.post('/setup/api/openclaw-cmd', { args: ['cron', 'list', '--json'] }),
        api.post('/setup/api/openclaw-cmd', { args: ['config', 'get', 'channels'] }),
      ]);

      const [statusRes, modelRes, projectsRes, debugRes, credRes, runnerRes, sessionsRes, cronRes, channelsRes] = results;

      // Version
      if (statusRes.status === 'fulfilled') {
        openclawVersion = statusRes.value.openclawVersion || statusRes.value.version || 'unknown';
      }

      // Model
      if (modelRes.status === 'fulfilled') {
        const m = modelRes.value;
        currentModel = m.model || m.output || 'unknown';
        if (currentModel.includes('\n')) {
          const match = currentModel.match(/model[:\s]+(.+)/i);
          currentModel = match ? match[1].trim() : currentModel.split('\n')[0].trim();
        }
      }

      // Projects
      if (projectsRes.status === 'fulfilled') {
        const p = projectsRes.value;
        const list = Array.isArray(p.projects) ? p.projects : [];
        projectCount = list.length;
        projectsDirty = list.filter(x => x.dirty).length;
      }

      // Debug / gateway logs
      if (debugRes.status === 'fulfilled') {
        const d = debugRes.value;
        const logs = d.gatewayLogs || d.logs || '';
        if (Array.isArray(logs)) {
          gatewayLogs = logs.slice(-40).join('\n');
        } else if (typeof logs === 'string') {
          gatewayLogs = logs.split('\n').slice(-40).join('\n');
        }
      }

      // Credentials
      if (credRes.status === 'fulfilled') {
        const output = credRes.value.output || '';
        credentialCount = parseCredentials(output);
        credentialTotal = TRACKED_CREDENTIALS.length;
      }

      // Runner queue
      if (runnerRes.status === 'fulfilled') {
        taskQueueCount = (runnerRes.value.tasks || []).length;
      }

      // Sessions
      if (sessionsRes.status === 'fulfilled') {
        try {
          const parsed = JSON.parse(sessionsRes.value.output || '{}');
          sessionCount = parsed.count ?? (Array.isArray(parsed.sessions) ? parsed.sessions.length : 0);
        } catch { sessionCount = 0; }
      }

      // Cron jobs
      if (cronRes.status === 'fulfilled') {
        try {
          const parsed = JSON.parse(cronRes.value.output || '[]');
          cronJobCount = Array.isArray(parsed) ? parsed.length : (parsed.jobs || []).length;
        } catch { cronJobCount = 0; }
      }

      // Telegram channel
      if (channelsRes.status === 'fulfilled') {
        try {
          const output = channelsRes.value.output || '';
          const channels = JSON.parse(output);
          telegramEnabled = channels?.telegram?.enabled || false;
          telegramStatus = telegramEnabled ? 'connected' : 'disabled';
        } catch { telegramStatus = 'unknown'; }
      }
    } catch (e) {
      error('Failed to load overview data: ' + e.message);
    } finally {
      loading = false;
    }
  }

  // Auto-refresh every 60 seconds
  let refreshInterval;
  onMount(() => {
    loadData();
    refreshInterval = setInterval(loadData, 60000);
  });
  onDestroy(() => clearInterval(refreshInterval));
</script>

<div style="animation: fadeIn 0.3s ease;">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-text">Overview</h1>
    <button
      class="text-xs text-text-3 hover:text-text-2 transition-colors cursor-pointer"
      onclick={() => loadData()}
    >Refresh</button>
  </div>

  <!-- Primary Metric Cards -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    <!-- Gateway Status -->
    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Gateway</span>
        <div class="flex items-center gap-2">
          <StatusDot status={gatewayColor} pulse={gatewayStatus === 'starting'} />
          <span class="text-lg font-bold text-text capitalize">{gatewayStatus}</span>
        </div>
        <span class="text-xs text-text-3">{configured ? 'Configured' : 'Not configured'}</span>
      </div>
    </Card>

    <!-- Current Model -->
    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Model</span>
        {#if loading}
          <Spinner size="sm" />
        {:else}
          <span class="font-mono text-accent-2 text-sm font-semibold truncate" title={currentModel}>{currentModel || 'Not set'}</span>
          <span class="text-xs text-text-3">v{openclawVersion || '?'}</span>
        {/if}
      </div>
    </Card>

    <!-- Projects -->
    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Projects</span>
        {#if loading}
          <Spinner size="sm" />
        {:else}
          <span class="text-lg font-bold text-text">{projectCount}</span>
          <div class="flex items-center gap-2 text-xs">
            {#if projectsDirty > 0}
              <Badge variant="warning">{projectsDirty} dirty</Badge>
            {:else}
              <span class="text-success">all clean</span>
            {/if}
          </div>
        {/if}
      </div>
    </Card>

    <!-- Credentials -->
    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Credentials</span>
        {#if loading}
          <Spinner size="sm" />
        {:else}
          <div class="flex items-center gap-2">
            <StatusDot status={credentialCount === credentialTotal ? 'green' : credentialCount > 0 ? 'yellow' : 'red'} />
            <span class="text-lg font-bold text-text">{credentialCount}/{credentialTotal}</span>
          </div>
          <span class="text-xs text-text-3">env vars set</span>
        {/if}
      </div>
    </Card>
  </div>

  <!-- Secondary Metric Cards -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
    <!-- Telegram -->
    <Card>
      <div class="flex items-center justify-between">
        <div>
          <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Telegram</span>
          {#if loading}
            <div class="mt-1"><Spinner size="sm" /></div>
          {:else}
            <div class="flex items-center gap-2 mt-1">
              <StatusDot status={telegramEnabled ? 'green' : 'red'} />
              <span class="text-sm font-medium">{telegramStatus}</span>
            </div>
          {/if}
        </div>
        <div class="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
          <svg class="w-4 h-4 text-info" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
          </svg>
        </div>
      </div>
    </Card>

    <!-- Sessions -->
    <Card>
      <div class="flex items-center justify-between">
        <div>
          <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Sessions</span>
          {#if loading}
            <div class="mt-1"><Spinner size="sm" /></div>
          {:else}
            <p class="text-lg font-bold text-text mt-1">{sessionCount}</p>
          {/if}
        </div>
        <div class="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
          <svg class="w-4 h-4 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
      </div>
    </Card>

    <!-- Task Queue -->
    <Card>
      <div class="flex items-center justify-between">
        <div>
          <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Task Queue</span>
          {#if loading}
            <div class="mt-1"><Spinner size="sm" /></div>
          {:else}
            <p class="text-lg font-bold text-text mt-1">{taskQueueCount}</p>
          {/if}
        </div>
        <div class="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
          <svg class="w-4 h-4 text-accent-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
          </svg>
        </div>
      </div>
    </Card>

    <!-- Cron Jobs -->
    <Card>
      <div class="flex items-center justify-between">
        <div>
          <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Cron Jobs</span>
          {#if loading}
            <div class="mt-1"><Spinner size="sm" /></div>
          {:else}
            <p class="text-lg font-bold text-text mt-1">{cronJobCount}</p>
          {/if}
        </div>
        <div class="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
          <svg class="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
    </Card>
  </div>

  <!-- Gateway Logs -->
  <div>
    <h2 class="text-lg font-semibold text-text mb-3">Gateway Logs</h2>
    {#if loading}
      <div class="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    {:else}
      <CodeOutput
        content={gatewayLogs}
        visible={true}
        title="Last 40 lines"
        maxHeight="400px"
      />
    {/if}
  </div>
</div>
