<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { success, error } from '$lib/stores/notifications.js';
  import Button from '$lib/components/shared/Button.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import StatusDot from '$lib/components/shared/StatusDot.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

  let tools = $state([]);
  let envVars = $state([]);
  let loadingTools = $state(true);
  let installing = $state(null);
  let installOutput = $state('');
  let showOutput = $state(false);

  // Set env var
  let setEnvName = $state('');
  let setEnvValue = $state('');
  let settingEnv = $state(false);

  async function loadTools() {
    loadingTools = true;
    try {
      const res = await api.get('/setup/api/tools/list');
      tools = res.tools || [];
      envVars = res.envVars || [];
    } catch (e) {
      error('Failed to load tools: ' + e.message);
    }
    loadingTools = false;
  }

  async function installTool(toolId) {
    installing = toolId;
    installOutput = '';
    showOutput = false;
    try {
      const res = await api.post('/setup/api/tools/install', { tool: toolId });
      installOutput = res.output || 'Installed successfully';
      showOutput = true;
      success(`${toolId} installed`);
      await loadTools();
    } catch (e) {
      installOutput = e.body || e.message;
      showOutput = true;
      error('Install failed: ' + (e.body || e.message));
    }
    installing = null;
  }

  async function setEnvVar() {
    if (!setEnvName.trim()) return;
    settingEnv = true;
    try {
      await api.post('/setup/api/tools/set-env', { name: setEnvName.trim(), value: setEnvValue });
      success(`${setEnvName} set in current process`);
      setEnvName = '';
      setEnvValue = '';
      await loadTools();
    } catch (e) {
      error('Failed: ' + (e.body || e.message));
    }
    settingEnv = false;
  }

  function getCategoryColor(cat) {
    if (cat === 'runtime') return 'info';
    if (cat === 'devops') return 'success';
    if (cat === 'deploy') return 'warning';
    if (cat === 'utility') return 'default';
    return 'default';
  }

  const installable = ['gh', 'jq', 'python3', 'curl', 'clawhub', 'wrangler'];

  onMount(() => {
    loadTools();
  });
</script>

<div>
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-text">Tools & Environment</h1>
    <Button variant="secondary" loading={loadingTools} onclick={loadTools}>Refresh</Button>
  </div>

  <div class="grid lg:grid-cols-2 gap-6">
    <!-- CLI Tools -->
    <div class="bg-surface border border-border rounded-xl overflow-hidden">
      <div class="px-4 py-3 border-b border-border bg-surface-2/50 flex items-center justify-between">
        <h2 class="text-xs font-medium text-text-3 uppercase tracking-wider">CLI Tools</h2>
        <span class="text-[10px] text-text-3">{tools.filter(t => t.installed).length}/{tools.length} installed</span>
      </div>
      <div class="divide-y divide-border/50">
        {#if loadingTools}
          {#each Array(8) as _}
            <div class="px-4 py-3">
              <div class="h-4 rounded bg-surface-2 w-32" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
            </div>
          {/each}
        {:else}
          {#each tools as tool}
            <div class="px-4 py-3 flex items-center justify-between gap-3 group hover:bg-surface-2/20 transition-colors">
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <span class="w-2 h-2 rounded-full flex-shrink-0 {tool.installed ? 'bg-success' : 'bg-danger/50'}"></span>
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-sm text-text">{tool.name || tool.id}</span>
                    {#if tool.category}
                      <Badge variant={getCategoryColor(tool.category)}>{tool.category}</Badge>
                    {/if}
                  </div>
                  {#if tool.installed && tool.version}
                    <span class="font-mono text-[10px] text-text-3 block truncate">{tool.version}</span>
                  {/if}
                </div>
              </div>
              <div class="flex-shrink-0">
                {#if tool.installed}
                  <Badge variant="success">Installed</Badge>
                {:else if installable.includes(tool.id)}
                  <Button variant="primary" size="sm"
                    loading={installing === tool.id}
                    onclick={() => installTool(tool.id)}>
                    Install
                  </Button>
                {:else}
                  <Badge variant="danger">Missing</Badge>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Environment Variables -->
    <div class="space-y-6">
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <div class="px-4 py-3 border-b border-border bg-surface-2/50 flex items-center justify-between">
          <h2 class="text-xs font-medium text-text-3 uppercase tracking-wider">Environment Variables</h2>
          <span class="text-[10px] text-text-3">{envVars.filter(v => v.set).length}/{envVars.length} configured</span>
        </div>
        <div class="divide-y divide-border/50">
          {#if loadingTools}
            {#each Array(10) as _}
              <div class="px-4 py-3">
                <div class="h-4 rounded bg-surface-2 w-40" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
              </div>
            {/each}
          {:else}
            {#each envVars as envVar}
              <div class="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-surface-2/20 transition-colors">
                <span class="font-mono text-xs text-text">{envVar.name}</span>
                <span class="w-2 h-2 rounded-full flex-shrink-0 {envVar.set ? 'bg-success' : 'bg-danger/50'}"></span>
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <!-- Set Env Var -->
      <div class="bg-surface border border-border rounded-xl p-4">
        <h3 class="text-xs font-medium text-text-3 uppercase tracking-wider mb-3">Set Environment Variable</h3>
        <div class="space-y-2">
          <input bind:value={setEnvName} placeholder="VARIABLE_NAME"
            class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text font-mono placeholder-text-3 focus:outline-none focus:border-accent/50" />
          <input bind:value={setEnvValue} placeholder="value" type="password"
            class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text font-mono placeholder-text-3 focus:outline-none focus:border-accent/50" />
          <div class="flex items-center justify-between">
            <p class="text-[10px] text-text-3">Sets in current process only. Use Railway vars for persistence.</p>
            <Button variant="primary" size="sm" loading={settingEnv} onclick={setEnvVar}>Set</Button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Install Output -->
  {#if showOutput}
    <div class="mt-6 bg-surface border border-border rounded-xl overflow-hidden">
      <div class="px-4 py-2 border-b border-border bg-surface-2/50 flex items-center justify-between">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Install Output</span>
        <button class="text-text-3 hover:text-text cursor-pointer text-xs" onclick={() => showOutput = false}>Close</button>
      </div>
      <pre class="p-4 text-xs font-mono text-text-2 max-h-60 overflow-y-auto whitespace-pre-wrap">{installOutput}</pre>
    </div>
  {/if}
</div>
