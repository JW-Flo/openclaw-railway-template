<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { success, error } from '$lib/stores/notifications.js';
  import Button from '$lib/components/shared/Button.svelte';
  import StatusDot from '$lib/components/shared/StatusDot.svelte';
  import CodeOutput from '$lib/components/shared/CodeOutput.svelte';

  const SYNC_REPOS = [
    'JW-Flo/Project-AtlasIT',
    'JW-Flo/AWhittleWandering',
    'JW-Flo/market_agents',
    'JW-Flo/JW-Site',
  ];

  let projects = $state([]);
  let loading = $state(true);
  let syncing = $state(false);
  let refreshing = $state(false);
  let syncOutput = $state('');
  let showSyncOutput = $state(false);

  async function loadProjects() {
    try {
      const res = await api.get('/setup/api/projects/status');
      projects = Array.isArray(res.projects) ? res.projects : [];
    } catch (e) {
      error('Failed to load projects: ' + e.message);
      projects = [];
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function refresh() {
    refreshing = true;
    await loadProjects();
    success('Projects refreshed');
  }

  async function syncAll() {
    syncing = true;
    syncOutput = '';
    showSyncOutput = false;
    try {
      const res = await api.post('/setup/api/projects/sync', { repos: SYNC_REPOS });
      syncOutput = res.output || JSON.stringify(res, null, 2);
      showSyncOutput = true;
      success('Projects synced successfully');
      await loadProjects();
    } catch (e) {
      syncOutput = 'Sync failed: ' + e.message;
      showSyncOutput = true;
      error('Sync failed: ' + e.message);
    } finally {
      syncing = false;
    }
  }

  onMount(() => {
    loadProjects();
  });
</script>

<div>
  <h1 class="text-2xl font-bold text-text mb-6">Projects</h1>

  <!-- Action bar -->
  <div class="flex items-center gap-3 mb-6">
    <Button variant="primary" loading={syncing} onclick={syncAll}>
      Sync All Projects
    </Button>
    <Button variant="secondary" loading={refreshing} onclick={refresh}>
      Refresh
    </Button>
  </div>

  <!-- Projects table -->
  <div class="bg-surface border border-border rounded-xl overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
              Name
            </th>
            <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
              Branch
            </th>
            <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
              Last Commit
            </th>
            <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {#if loading}
            {#each Array(4) as _}
              <tr>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-36" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-20" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-56" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-24" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
              </tr>
            {/each}
          {:else if projects.length === 0}
            <tr>
              <td colspan="4" class="px-4 py-12 text-center text-sm text-text-3">
                No projects cloned yet. Click Sync All to clone.
              </td>
            </tr>
          {:else}
            {#each projects as project}
              <tr class="group">
                <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                  <span class="font-semibold text-text">{project.name}</span>
                </td>
                <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                  <span class="font-mono text-xs text-text-2">{project.branch || 'N/A'}</span>
                </td>
                <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                  <span class="font-mono text-xs text-text-2">{project.lastCommit || 'N/A'}</span>
                </td>
                <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                  {#if project.dirty}
                    <StatusDot status="yellow" label="{project.dirtyFiles || '?'} changed" />
                  {:else}
                    <StatusDot status="green" label="Clean" />
                  {/if}
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Sync output -->
  <div class="mt-6">
    <CodeOutput content={syncOutput} visible={showSyncOutput} title="Sync Output" maxHeight="400px" />
  </div>
</div>
