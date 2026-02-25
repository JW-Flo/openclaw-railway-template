<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { success, error } from '$lib/stores/notifications.js';
  import Button from '$lib/components/shared/Button.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import CodeOutput from '$lib/components/shared/CodeOutput.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

  let skills = $state([]);
  let loading = $state(true);
  let refreshing = $state(false);
  let operationOutput = $state('');
  let showOutput = $state(false);

  // Search state
  let searchQuery = $state('');
  let searchResults = $state('');
  let searching = $state(false);

  // Install state
  let installSource = $state('');
  let forceInstall = $state(false);
  let installing = $state(false);

  // Uninstall state
  let uninstallingSkill = $state('');

  function parseSkillList(output) {
    if (!output) return [];
    const lines = output.split('\n');
    const parsed = [];
    for (const line of lines) {
      if (!line.includes('│')) continue;
      if (line.includes('──') || line.includes('Status')) continue;
      const cells = line.split('│').map(c => c.trim()).filter(c => c !== '');
      if (cells.length >= 4) {
        parsed.push({
          status: cells[0],
          name: cells[1],
          description: cells[2],
          source: cells[3],
        });
      }
    }
    return parsed;
  }

  async function loadSkills() {
    try {
      const res = await api.get('/setup/api/skills/list');
      skills = parseSkillList(res.output);
    } catch (e) {
      error('Failed to load skills: ' + e.message);
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function refreshSkills() {
    refreshing = true;
    await loadSkills();
    success('Skills list refreshed');
  }

  async function searchSkills() {
    if (!searchQuery.trim()) return;
    searching = true;
    searchResults = '';
    try {
      const res = await api.post('/setup/api/skills/search', { query: searchQuery.trim() });
      searchResults = res.output || 'No results found.';
    } catch (e) {
      error('Search failed: ' + e.message);
      searchResults = 'Search failed: ' + e.message;
    } finally {
      searching = false;
    }
  }

  async function installSkill() {
    if (!installSource.trim()) return;
    installing = true;
    operationOutput = '';
    showOutput = false;
    try {
      const res = await api.post('/setup/api/skills/install', {
        source: installSource.trim(),
        force: forceInstall,
      });
      operationOutput = res.output || 'Skill installed successfully.';
      showOutput = true;
      success('Skill installed successfully');
      installSource = '';
      forceInstall = false;
      await loadSkills();
    } catch (e) {
      operationOutput = 'Install failed: ' + e.message;
      showOutput = true;
      error('Install failed: ' + e.message);
    } finally {
      installing = false;
    }
  }

  async function uninstallSkill(name) {
    uninstallingSkill = name;
    operationOutput = '';
    showOutput = false;
    try {
      const res = await api.post('/setup/api/skills/uninstall', { name });
      operationOutput = res.output || `Skill "${name}" uninstalled.`;
      showOutput = true;
      success(`Skill "${name}" uninstalled`);
      await loadSkills();
    } catch (e) {
      operationOutput = 'Uninstall failed: ' + e.message;
      showOutput = true;
      error('Uninstall failed: ' + e.message);
    } finally {
      uninstallingSkill = '';
    }
  }

  function isWorkspaceSkill(skill) {
    return skill.source && skill.source.toLowerCase().includes('workspace');
  }

  function isReady(skill) {
    return skill.status && skill.status.toLowerCase().includes('ready');
  }

  function handleSearchKeydown(e) {
    if (e.key === 'Enter') searchSkills();
  }

  function handleInstallKeydown(e) {
    if (e.key === 'Enter') installSkill();
  }

  onMount(() => {
    loadSkills();
  });
</script>

<div>
  <h1 class="text-2xl font-bold text-text mb-6">Skills</h1>

  <!-- Action bar -->
  <div class="flex items-center gap-3 mb-6">
    <Button variant="secondary" loading={refreshing} onclick={refreshSkills}>
      Refresh Skills
    </Button>
  </div>

  <!-- Installed Skills -->
  <div class="bg-surface border border-border rounded-xl overflow-hidden">
    <div class="px-4 py-3 border-b border-border bg-surface-2/50">
      <h2 class="text-xs font-medium text-text-3 uppercase tracking-wider">Installed Skills</h2>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
              Skill
            </th>
            <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
              Status
            </th>
            <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
              Description
            </th>
            <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {#if loading}
            {#each Array(4) as _, i}
              <tr>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-32" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-16" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-48" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-20" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
              </tr>
            {/each}
          {:else if skills.length === 0}
            <tr>
              <td colspan="4" class="px-4 py-12 text-center text-sm text-text-3">
                No skills found. Install skills from ClawHub below.
              </td>
            </tr>
          {:else}
            {#each skills as skill}
              <tr class="group">
                <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                  <span class="font-mono text-sm font-semibold text-text">{skill.name}</span>
                </td>
                <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                  {#if isReady(skill)}
                    <Badge variant="success">Ready</Badge>
                  {:else}
                    <Badge variant="danger">Missing</Badge>
                  {/if}
                </td>
                <td class="px-4 py-3 text-sm border-b border-border/50 text-text-2 transition-colors duration-150 group-hover:bg-surface-2/30">
                  {skill.description}
                </td>
                <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                  {#if isWorkspaceSkill(skill)}
                    <Button
                      variant="danger"
                      size="sm"
                      loading={uninstallingSkill === skill.name}
                      onclick={() => uninstallSkill(skill.name)}
                    >
                      Uninstall
                    </Button>
                  {:else}
                    <Badge variant="default">bundled</Badge>
                  {/if}
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Install from ClawHub -->
  <div class="mt-8">
    <Card title="Install from ClawHub">
      <!-- Search -->
      <div class="mb-6">
        <label class="text-sm font-medium text-text-2 mb-1.5 block">Search ClawHub</label>
        <div class="flex items-center gap-3">
          <input
            type="text"
            bind:value={searchQuery}
            onkeydown={handleSearchKeydown}
            placeholder="Search for skills..."
            class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text flex-1 focus:border-accent focus:outline-none"
          />
          <Button variant="secondary" loading={searching} onclick={searchSkills}>
            Search
          </Button>
        </div>
        {#if searchResults}
          <div class="mt-3 font-mono text-xs bg-bg p-4 rounded-lg max-h-60 overflow-y-auto whitespace-pre-wrap text-text-2 border border-border">
            {searchResults}
          </div>
        {/if}
      </div>

      <!-- Install -->
      <div>
        <label class="text-sm font-medium text-text-2 mb-1.5 block">Install Skill</label>
        <div class="flex items-center gap-3">
          <input
            type="text"
            bind:value={installSource}
            onkeydown={handleInstallKeydown}
            placeholder="skill-name or github:user/repo"
            class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text flex-1 focus:border-accent focus:outline-none"
          />
          <label class="flex items-center gap-2 text-sm text-text-2 cursor-pointer select-none">
            <input
              type="checkbox"
              bind:checked={forceInstall}
              class="w-4 h-4 rounded border-border accent-accent"
            />
            Force
          </label>
          <Button variant="primary" loading={installing} onclick={installSkill}>
            Install
          </Button>
        </div>
      </div>
    </Card>
  </div>

  <!-- Operation output -->
  <div class="mt-6">
    <CodeOutput content={operationOutput} visible={showOutput} title="Operation Output" />
  </div>
</div>
