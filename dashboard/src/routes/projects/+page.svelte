<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { success, error } from '$lib/stores/notifications.js';
  import Button from '$lib/components/shared/Button.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import StatusDot from '$lib/components/shared/StatusDot.svelte';
  import CodeOutput from '$lib/components/shared/CodeOutput.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

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

  // Create project
  let showCreate = $state(false);
  let creating = $state(false);
  let newProject = $state({ name: '', repo: '', description: '', template: 'none' });

  // AI Ideas
  let showIdeas = $state(false);
  let ideasLoading = $state(false);
  let ideas = $state([]);
  let ideasRaw = $state('');

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

  async function createProject() {
    if (!newProject.name.trim()) return;
    creating = true;
    try {
      const payload = {
        name: newProject.name.trim(),
        description: newProject.description.trim(),
      };
      if (newProject.repo.trim()) payload.repo = newProject.repo.trim();
      if (newProject.template !== 'none') payload.template = newProject.template;
      await api.post('/setup/api/projects/create', payload);
      success(`Project "${newProject.name}" created`);
      newProject = { name: '', repo: '', description: '', template: 'none' };
      showCreate = false;
      await loadProjects();
    } catch (e) {
      error('Create failed: ' + (e.body || e.message));
    }
    creating = false;
  }

  async function generateIdeas() {
    ideasLoading = true;
    ideas = [];
    ideasRaw = '';
    showIdeas = true;
    try {
      const res = await api.post('/setup/api/projects/ideas', {
        context: 'Suggest innovative project ideas covering: AI/ML tools, web apps, automation, data analysis, and creative coding. Consider the existing portfolio.',
      });
      ideas = res.ideas || [];
      ideasRaw = res.raw || '';
      if (ideas.length > 0) success(`Generated ${ideas.length} project ideas`);
    } catch (e) {
      error('Idea generation failed: ' + (e.body || e.message));
    }
    ideasLoading = false;
  }

  function useIdea(idea) {
    newProject = {
      name: idea.name || '',
      repo: '',
      description: idea.description || '',
      template: idea.template === 'node' || idea.template === 'python' ? idea.template : 'none',
    };
    showCreate = true;
    showIdeas = false;
  }

  onMount(() => {
    loadProjects();
  });
</script>

<div>
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-text">Projects</h1>
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="sm" onclick={generateIdeas}>
        <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
        AI Ideas
      </Button>
      <Button variant="primary" onclick={() => showCreate = true}>
        <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New Project
      </Button>
      <Button variant="secondary" loading={syncing} onclick={syncAll}>Sync All</Button>
      <Button variant="ghost" loading={refreshing} onclick={refresh}>Refresh</Button>
    </div>
  </div>

  <!-- AI Ideas Panel -->
  {#if showIdeas}
    <div class="bg-accent/5 border border-accent/20 rounded-xl p-4 mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-accent-2 flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
          AI Project Ideas
        </h2>
        <button class="text-text-3 hover:text-text cursor-pointer" onclick={() => showIdeas = false}>&times;</button>
      </div>
      {#if ideasLoading}
        <div class="flex items-center gap-2 py-6 justify-center">
          <Spinner size="md" />
          <span class="text-sm text-text-3">Generating ideas based on your portfolio...</span>
        </div>
      {:else if ideas.length > 0}
        <div class="grid gap-2">
          {#each ideas as idea}
            <div class="bg-bg rounded-xl p-3 flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-sm text-text">{idea.name}</span>
                  {#if idea.category}
                    <Badge variant="info">{idea.category}</Badge>
                  {/if}
                  {#if idea.difficulty}
                    <Badge variant={idea.difficulty === 'easy' ? 'success' : idea.difficulty === 'hard' ? 'danger' : 'warning'}>
                      {idea.difficulty}
                    </Badge>
                  {/if}
                </div>
                <p class="text-xs text-text-2 mt-1">{idea.description}</p>
              </div>
              <Button variant="primary" size="sm" onclick={() => useIdea(idea)}>Use</Button>
            </div>
          {/each}
        </div>
      {:else if ideasRaw}
        <div class="font-mono text-xs text-text-2 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {ideasRaw}
        </div>
      {:else}
        <p class="text-xs text-text-3">No ideas generated yet. Click "AI Ideas" to get started.</p>
      {/if}
    </div>
  {/if}

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
                No projects cloned yet. Click "New Project" or "Sync All" to get started.
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

  <!-- Create Project Dialog -->
  {#if showCreate}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onclick={(e) => { if (e.target === e.currentTarget) showCreate = false; }}>
      <div class="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md" style="animation: fadeIn 0.15s ease;">
        <div class="px-6 py-4 border-b border-border">
          <h2 class="text-lg font-semibold text-text">Create Project</h2>
        </div>
        <div class="px-6 py-4 space-y-3">
          <div>
            <label class="text-xs text-text-3 block mb-1">Project Name</label>
            <input bind:value={newProject.name} placeholder="my-awesome-project"
              class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label class="text-xs text-text-3 block mb-1">Clone from Repo (optional)</label>
            <input bind:value={newProject.repo} placeholder="user/repo or https://github.com/..."
              class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50" />
            <p class="text-[10px] text-text-3 mt-1">Leave blank to create a new empty project</p>
          </div>
          <div>
            <label class="text-xs text-text-3 block mb-1">Description</label>
            <textarea bind:value={newProject.description} placeholder="What this project does..."
              rows="2"
              class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50 resize-none"></textarea>
          </div>
          {#if !newProject.repo}
            <div>
              <label class="text-xs text-text-3 block mb-1">Template</label>
              <select bind:value={newProject.template}
                class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50">
                <option value="none">Blank (README only)</option>
                <option value="node">Node.js</option>
                <option value="python">Python</option>
              </select>
            </div>
          {/if}
        </div>
        <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
          <Button variant="ghost" onclick={() => showCreate = false}>Cancel</Button>
          <Button variant="primary" loading={creating} onclick={createProject}>Create</Button>
        </div>
      </div>
    </div>
  {/if}
</div>
