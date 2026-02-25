<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import Card from '$lib/components/shared/Card.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import CodeOutput from '$lib/components/shared/CodeOutput.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';
  import StatusDot from '$lib/components/shared/StatusDot.svelte';
  import { success, error as notifyError } from '$lib/stores/notifications.js';

  let loading = $state(true);
  let tasks = $state([]);
  let config = $state({});
  let history = $state([]);
  let status = $state(null);
  let notConfigured = $state(false);

  let addModalOpen = $state(false);
  let addLoading = $state(false);
  let formProject = $state('JW-Flo/Project-AtlasIT');
  let formTitle = $state('');
  let formDescription = $state('');
  let formPriority = $state(5);

  let roadmapLoading = $state(false);
  let roadmapOutput = $state('');

  async function loadQueue() {
    loading = true;
    notConfigured = false;
    try {
      const data = await api.get('/setup/api/runner/queue');
      tasks = data.tasks || [];
      config = data.config || {};
    } catch (err) {
      if (err.status === 404) {
        notConfigured = true;
      }
      tasks = [];
    }
    try {
      const s = await api.get('/setup/api/runner/status');
      status = s;
    } catch { status = null; }
    try {
      const h = await api.get('/setup/api/runner/history');
      history = h.tasks || h.history || [];
    } catch { history = []; }
    loading = false;
  }

  async function addTask() {
    if (!formTitle.trim()) return;
    addLoading = true;
    try {
      await api.post('/setup/api/runner/add', {
        project: formProject,
        title: formTitle.trim(),
        description: formDescription.trim(),
        priority: formPriority,
      });
      success('Task added to queue');
      addModalOpen = false;
      formTitle = '';
      formDescription = '';
      formPriority = 5;
      await loadQueue();
    } catch (err) {
      notifyError('Failed to add task: ' + (err.body || err.message));
    } finally {
      addLoading = false;
    }
  }

  async function removeTask(id) {
    try {
      await api.post('/setup/api/runner/remove', { id });
      success('Task removed');
      await loadQueue();
    } catch (err) {
      notifyError('Failed to remove: ' + (err.body || err.message));
    }
  }

  async function togglePause() {
    try {
      const paused = !(config.paused);
      await api.post('/setup/api/runner/pause', { paused });
      success(paused ? 'Runner paused' : 'Runner resumed');
      await loadQueue();
    } catch (err) {
      notifyError('Failed: ' + (err.body || err.message));
    }
  }

  async function runRoadmap() {
    roadmapLoading = true;
    roadmapOutput = '';
    try {
      const data = await api.post('/setup/api/openclaw-cmd', {
        args: ['agent', '--session-id', 'roadmap', '--message', 'Run the roadmap-planner skill: analyze all managed projects, generate a prioritized development roadmap, update CLAUDE.md files, and queue tasks for the agent runner.', '--timeout', '300']
      });
      roadmapOutput = data.output || 'Roadmap planner triggered successfully.';
      success('Roadmap planner started');
    } catch (err) {
      roadmapOutput = 'Error: ' + (err.body || err.message);
      notifyError('Failed to start roadmap planner');
    } finally {
      roadmapLoading = false;
    }
  }

  let projects = $state([]);

  async function loadProjects() {
    try {
      const data = await api.get('/setup/api/projects/status');
      projects = (data.projects || []).map(p => p.name || p.path || '');
    } catch {
      projects = ['JW-Flo/Project-AtlasIT', 'JW-Flo/AWhittleWandering', 'JW-Flo/market_agents', 'JW-Flo/JW-Site'];
    }
  }

  onMount(() => { loadQueue(); loadProjects(); });

  let sortedTasks = $derived([...tasks].sort((a, b) => (a.priority || 5) - (b.priority || 5)));
</script>

<div style="animation: fadeIn 0.3s ease;">
  <div class="flex items-center justify-between mb-2">
    <div>
      <h1 class="text-2xl font-bold text-text">Agent Runner</h1>
      <p class="text-sm text-text-2 mt-1">Autonomous task execution across managed projects</p>
    </div>
  </div>

  {#if loading}
    <div class="flex justify-center py-16"><Spinner size="lg" /></div>
  {:else if notConfigured}
    <Card>
      <div class="text-center py-12">
        <div class="text-4xl mb-4 opacity-30">&#x2699;</div>
        <p class="text-text-2 mb-2">Agent Runner is ready.</p>
        <p class="text-sm text-text-3">Add tasks to the queue and set up the agent-runner cron job to begin autonomous execution.</p>
        <div class="mt-6 flex justify-center gap-3">
          <Button variant="primary" onclick={() => addModalOpen = true}>Add First Task</Button>
          <Button variant="secondary" onclick={runRoadmap} loading={roadmapLoading}>Run Roadmap Planner</Button>
        </div>
      </div>
    </Card>
  {:else}
    <!-- Status Bar -->
    <div class="flex flex-wrap items-center gap-6 mb-6 p-4 bg-surface rounded-xl border border-border">
      <div class="flex items-center gap-2">
        <StatusDot status={config.paused ? 'yellow' : 'green'} />
        <span class="text-sm font-medium">{config.paused ? 'Paused' : 'Active'}</span>
      </div>
      <div>
        <span class="text-lg font-bold">{status?.tasksToday || 0}</span>
        <span class="text-xs text-text-2 ml-1">tasks today</span>
      </div>
      <div class="text-xs text-text-2">
        {#if status?.currentTask}
          Running: <span class="text-accent-2 font-medium">{status.currentTask}</span>
        {:else}
          Idle
        {/if}
      </div>
      <div class="ml-auto">
        <Button variant="ghost" size="sm" onclick={togglePause}>
          {config.paused ? 'Resume' : 'Pause'}
        </Button>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-3 mb-6">
      <Button variant="primary" onclick={() => addModalOpen = true}>Add Task</Button>
      <Button variant="secondary" onclick={loadQueue} loading={loading}>Refresh</Button>
      <Button variant="ghost" onclick={runRoadmap} loading={roadmapLoading}>Run Roadmap Planner</Button>
    </div>

    <!-- Task Queue -->
    <div class="bg-surface border border-border rounded-xl overflow-hidden mb-8">
      <div class="px-4 py-3 border-b border-border bg-surface-2/30">
        <h3 class="text-sm font-semibold text-text-2">Task Queue ({sortedTasks.length})</h3>
      </div>
      {#if sortedTasks.length === 0}
        <div class="text-center py-12 text-text-3 text-sm">
          No tasks in queue. Add tasks or run the Roadmap Planner to auto-generate tasks.
        </div>
      {:else}
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">#</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">Project</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">Title</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">Status</th>
              <th class="text-right px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each sortedTasks as task}
              <tr class="hover:bg-surface-2/30 transition-colors">
                <td class="px-4 py-3 text-sm font-mono text-text-2 border-b border-border/50">{task.priority}</td>
                <td class="px-4 py-3 text-sm border-b border-border/50">
                  {#if task.project}
                    <Badge variant="accent">{task.project.split('/').pop()}</Badge>
                  {:else}
                    <span class="text-text-3">—</span>
                  {/if}
                </td>
                <td class="px-4 py-3 text-sm font-semibold border-b border-border/50">
                  {task.title}
                  {#if task.description}
                    <p class="text-xs text-text-3 font-normal mt-0.5 truncate max-w-md">{task.description}</p>
                  {/if}
                </td>
                <td class="px-4 py-3 text-sm border-b border-border/50">
                  <Badge variant={task.status === 'pending' ? 'default' : task.status === 'running' ? 'accent' : task.status === 'completed' ? 'success' : 'danger'}>
                    {task.status}
                  </Badge>
                </td>
                <td class="px-4 py-3 text-sm text-right border-b border-border/50">
                  <Button variant="danger" size="sm" onclick={() => removeTask(task.id)}>Remove</Button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    {#if roadmapOutput}
      <CodeOutput content={roadmapOutput} title="Roadmap Planner Output" visible={true} />
    {/if}

    <!-- History -->
    {#if history.length > 0}
      <div class="mt-8">
        <h3 class="text-lg font-semibold mb-4">Completed Tasks</h3>
        <div class="bg-surface border border-border rounded-xl overflow-hidden">
          <table class="w-full border-collapse">
            <thead>
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">Title</th>
                <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">Project</th>
                <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">Completed</th>
                <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">Result</th>
              </tr>
            </thead>
            <tbody>
              {#each history.slice(0, 20) as task}
                <tr class="hover:bg-surface-2/30 transition-colors">
                  <td class="px-4 py-3 text-sm font-semibold border-b border-border/50">{task.title}</td>
                  <td class="px-4 py-3 text-sm border-b border-border/50">
                    <Badge variant="default">{(task.project || '').split('/').pop() || '—'}</Badge>
                  </td>
                  <td class="px-4 py-3 text-xs text-text-2 border-b border-border/50">{task.completedAt || '—'}</td>
                  <td class="px-4 py-3 text-sm border-b border-border/50">
                    <Badge variant={task.status === 'completed' ? 'success' : 'danger'}>
                      {task.status === 'completed' ? 'Success' : 'Failed'}
                    </Badge>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {/if}

  <!-- Add Task Modal -->
  <Modal bind:open={addModalOpen} title="Add Task" size="md">
    <div class="space-y-4">
      <div>
        <label class="text-sm font-medium text-text-2 mb-1.5 block">Project</label>
        <select bind:value={formProject} class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none appearance-none">
          {#each projects as p}
            <option value={p}>{p}</option>
          {/each}
        </select>
      </div>
      <div>
        <label class="text-sm font-medium text-text-2 mb-1.5 block">Title</label>
        <input bind:value={formTitle} type="text" placeholder="e.g. Add unit tests for API" class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none" />
      </div>
      <div>
        <label class="text-sm font-medium text-text-2 mb-1.5 block">Description</label>
        <textarea bind:value={formDescription} placeholder="Detailed instructions for the agent..." rows="4" class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none resize-y min-h-24"></textarea>
      </div>
      <div>
        <label class="text-sm font-medium text-text-2 mb-1.5 block">Priority (1 = highest)</label>
        <input bind:value={formPriority} type="number" min="1" max="10" class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-24 focus:border-accent focus:outline-none" />
      </div>
    </div>
    <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
      <Button variant="secondary" onclick={() => addModalOpen = false}>Cancel</Button>
      <Button variant="primary" onclick={addTask} loading={addLoading} disabled={!formTitle.trim()}>Add Task</Button>
    </div>
  </Modal>
</div>
