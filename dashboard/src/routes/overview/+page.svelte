<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { error } from '$lib/stores/notifications.js';
  import Card from '$lib/components/shared/Card.svelte';
  import StatusDot from '$lib/components/shared/StatusDot.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';
  import CodeOutput from '$lib/components/shared/CodeOutput.svelte';

  let loading = $state(true);

  // Data
  let gatewayStatus = $state('unknown');
  let configured = $state(false);
  let currentModel = $state('');
  let projectCount = $state(0);
  let openclawVersion = $state('');
  let credentialCount = $state(0);
  let gatewayLogs = $state('');

  let gatewayColor = $derived(
    gatewayStatus === 'running' ? 'green'
      : gatewayStatus === 'starting' ? 'yellow'
      : 'red'
  );

  const TRACKED_CREDENTIALS = [
    'GH_PAT',
    'OPENROUTER_API_TOKEN',
    'ANTHROPIC_API_KEY',
    'CLOUDFLARE_ACCOUNT_ID',
    'RAILWAY_ACCOUNT_TOKEN',
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
      const [healthRes, statusRes, modelRes, projectsRes, debugRes, credRes] = await Promise.allSettled([
        api.get('/setup/healthz'),
        api.get('/setup/api/status'),
        api.get('/setup/api/models/current'),
        api.get('/setup/api/projects/status'),
        api.get('/setup/api/debug'),
        api.post('/setup/api/shell', { command: 'env' }),
      ]);

      // Gateway status
      if (healthRes.status === 'fulfilled') {
        const h = healthRes.value;
        gatewayStatus = h.gateway || 'unknown';
        configured = h.configured || false;
      }

      // Version
      if (statusRes.status === 'fulfilled') {
        openclawVersion = statusRes.value.openclawVersion || statusRes.value.version || 'unknown';
      }

      // Model
      if (modelRes.status === 'fulfilled') {
        const m = modelRes.value;
        currentModel = m.model || m.output || 'unknown';
        // Clean up if output is multiline text
        if (currentModel.includes('\n')) {
          const match = currentModel.match(/model[:\s]+(.+)/i);
          currentModel = match ? match[1].trim() : currentModel.split('\n')[0].trim();
        }
      }

      // Projects
      if (projectsRes.status === 'fulfilled') {
        const p = projectsRes.value;
        projectCount = Array.isArray(p.projects) ? p.projects.length : 0;
      }

      // Debug / gateway logs
      if (debugRes.status === 'fulfilled') {
        const d = debugRes.value;
        const logs = d.gatewayLogs || d.logs || '';
        if (Array.isArray(logs)) {
          gatewayLogs = logs.slice(-30).join('\n');
        } else if (typeof logs === 'string') {
          gatewayLogs = logs.split('\n').slice(-30).join('\n');
        }
      }

      // Credentials
      if (credRes.status === 'fulfilled') {
        const output = credRes.value.output || '';
        credentialCount = parseCredentials(output);
      }
    } catch (e) {
      error('Failed to load overview data: ' + e.message);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadData();
  });
</script>

<div>
  <h1 class="text-2xl font-bold text-text mb-6">Overview</h1>

  <!-- Metric Cards Grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
    <!-- Gateway Status -->
    <Card title="Gateway">
      {#if loading}
        <div class="flex items-center justify-center py-2">
          <Spinner size="sm" />
        </div>
      {:else}
        <div class="flex items-center gap-3">
          <StatusDot
            status={gatewayColor}
            pulse={gatewayStatus === 'starting'}
          />
          <span class="text-sm font-medium text-text capitalize">{gatewayStatus}</span>
        </div>
      {/if}
    </Card>

    <!-- Configuration -->
    <Card title="Configuration">
      {#if loading}
        <div class="flex items-center justify-center py-2">
          <Spinner size="sm" />
        </div>
      {:else}
        <div class="flex items-center gap-3">
          <StatusDot status={configured ? 'green' : 'red'} />
          <span class="text-sm font-medium text-text">
            {configured ? 'Configured' : 'Not configured'}
          </span>
        </div>
      {/if}
    </Card>

    <!-- Current Model -->
    <Card title="Current Model">
      {#if loading}
        <div class="flex items-center justify-center py-2">
          <Spinner size="sm" />
        </div>
      {:else}
        <span class="font-mono text-accent-2 text-sm">{currentModel || 'Not set'}</span>
      {/if}
    </Card>

    <!-- Projects -->
    <Card title="Projects">
      {#if loading}
        <div class="flex items-center justify-center py-2">
          <Spinner size="sm" />
        </div>
      {:else}
        <span class="text-3xl font-bold text-text">{projectCount}</span>
      {/if}
    </Card>

    <!-- Version -->
    <Card title="Version">
      {#if loading}
        <div class="flex items-center justify-center py-2">
          <Spinner size="sm" />
        </div>
      {:else}
        <span class="font-mono text-sm text-text-2">{openclawVersion || 'Unknown'}</span>
      {/if}
    </Card>

    <!-- Credentials -->
    <Card title="Credentials">
      {#if loading}
        <div class="flex items-center justify-center py-2">
          <Spinner size="sm" />
        </div>
      {:else}
        <div class="flex items-center gap-3">
          <StatusDot
            status={credentialCount === TRACKED_CREDENTIALS.length ? 'green' : credentialCount > 0 ? 'yellow' : 'red'}
          />
          <span class="text-sm font-medium text-text">
            {credentialCount}/{TRACKED_CREDENTIALS.length} set
          </span>
        </div>
      {/if}
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
        title="Last 30 lines"
        maxHeight="400px"
      />
    {/if}
  </div>
</div>
