<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { error } from '$lib/stores/notifications.js';
  import StatusDot from '$lib/components/shared/StatusDot.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

  const CLI_TOOLS = [
    { name: 'gh', cmd: 'gh --version 2>&1 | head -1' },
    { name: 'git', cmd: 'git --version 2>&1 | head -1' },
    { name: 'node', cmd: 'node --version 2>&1 | head -1' },
    { name: 'npm', cmd: 'npm --version 2>&1 | head -1' },
    { name: 'jq', cmd: 'jq --version 2>&1 | head -1' },
    { name: 'wrangler', cmd: 'wrangler --version 2>&1 | head -1' },
    { name: 'railway', cmd: 'railway version 2>&1 | head -1' },
  ];

  const ENV_VARS = [
    'GH_PAT',
    'OPENROUTER_API_TOKEN',
    'ANTHROPIC_API_KEY',
    'CLOUDFLARE_ACCOUNT_ID',
    'RAILWAY_ACCOUNT_TOKEN',
    'TELEGRAM_API_ID',
    'TELEGRAM_API_HASH',
    'GROK_API_KEY',
    'SETUP_PASSWORD',
    'OPENCLAW_GATEWAY_TOKEN',
  ];

  let tools = $state([]);
  let envVars = $state([]);
  let loadingTools = $state(true);
  let loadingEnv = $state(true);

  async function checkTool(tool) {
    try {
      const res = await api.post('/setup/api/shell', { command: tool.cmd });
      const output = (res.output || '').trim();
      if (output && !output.toLowerCase().includes('not found') && !output.toLowerCase().includes('command not found')) {
        return { name: tool.name, installed: true, version: output };
      }
      return { name: tool.name, installed: false, version: '' };
    } catch {
      return { name: tool.name, installed: false, version: '' };
    }
  }

  async function loadTools() {
    loadingTools = true;
    try {
      const results = await Promise.all(CLI_TOOLS.map(checkTool));
      tools = results;
    } catch (e) {
      error('Failed to check tools: ' + e.message);
    } finally {
      loadingTools = false;
    }
  }

  async function loadEnvVars() {
    loadingEnv = true;
    try {
      const res = await api.post('/setup/api/shell', {
        command: ENV_VARS.map(v => `echo "${v}=$(printenv ${v} | head -c 1)"`).join(' && '),
      });
      const output = res.output || '';
      const parsed = [];
      for (const varName of ENV_VARS) {
        const regex = new RegExp(`^${varName}=(.*)$`, 'm');
        const match = output.match(regex);
        const isSet = match ? match[1].trim().length > 0 : false;
        parsed.push({ name: varName, isSet });
      }
      envVars = parsed;
    } catch (e) {
      error('Failed to check environment variables: ' + e.message);
      envVars = ENV_VARS.map(name => ({ name, isSet: false }));
    } finally {
      loadingEnv = false;
    }
  }

  onMount(() => {
    loadTools();
    loadEnvVars();
  });
</script>

<div>
  <h1 class="text-2xl font-bold text-text mb-6">Tools & Environment</h1>

  <div class="grid lg:grid-cols-2 gap-6">
    <!-- CLI Tools -->
    <div class="bg-surface border border-border rounded-xl overflow-hidden">
      <div class="px-4 py-3 border-b border-border bg-surface-2/50">
        <h2 class="text-xs font-medium text-text-3 uppercase tracking-wider">CLI Tools</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Name
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Status
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Version
              </th>
            </tr>
          </thead>
          <tbody>
            {#if loadingTools}
              {#each Array(7) as _, i}
                <tr>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-20" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-24" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-32" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                </tr>
              {/each}
            {:else}
              {#each tools as tool}
                <tr class="group">
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="font-semibold text-text">{tool.name}</span>
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    {#if tool.installed}
                      <StatusDot status="green" label="Installed" />
                    {:else}
                      <StatusDot status="red" label="Missing" />
                    {/if}
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="font-mono text-xs text-text-2">{tool.version || '--'}</span>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Environment Variables -->
    <div class="bg-surface border border-border rounded-xl overflow-hidden">
      <div class="px-4 py-3 border-b border-border bg-surface-2/50">
        <h2 class="text-xs font-medium text-text-3 uppercase tracking-wider">Environment Variables</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Variable
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {#if loadingEnv}
              {#each Array(10) as _, i}
                <tr>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-40" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-16" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                </tr>
              {/each}
            {:else}
              {#each envVars as envVar}
                <tr class="group">
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="font-mono text-xs text-text">{envVar.name}</span>
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    {#if envVar.isSet}
                      <StatusDot status="green" label="Set" />
                    {:else}
                      <StatusDot status="red" label="Not set" />
                    {/if}
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>
