<script>
  import { onMount, onDestroy } from 'svelte';
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

  // Add task modal
  let addModalOpen = $state(false);
  let addLoading = $state(false);
  let formProject = $state('');
  let formTitle = $state('');
  let formDescription = $state('');
  let formPriority = $state(5);

  // Edit task modal
  let editModalOpen = $state(false);
  let editLoading = $state(false);
  let editTask = $state(null);

  // Config panel
  let configOpen = $state(false);
  let configLoading = $state(false);
  let configForm = $state({});

  // AI suggestions
  let suggestLoading = $state(false);
  let suggestions = $state([]);
  let suggestFilter = $state('');
  let suggestRaw = $state('');

  // Roadmap
  let roadmapLoading = $state(false);
  let roadmapOutput = $state('');

  // Task execution
  let runningTasks = $state(new Set());

  async function loadQueue() {
    loading = true;
    notConfigured = false;
    try {
      const data = await api.get('/setup/api/runner/queue');
      tasks = data.tasks || [];
      config = data.config || {};
      configForm = { ...config, engines: undefined };
    } catch (err) {
      if (err.status === 404) notConfigured = true;
      tasks = [];
    }
    try {
      const s = await api.get('/setup/api/runner/status');
      status = s;
    } catch { status = null; }
    try {
      const h = await api.get('/setup/api/runner/history');
      history = h.history || h.tasks || [];
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

  async function runTask(task) {
    runningTasks.add(task.id);
    runningTasks = new Set(runningTasks);
    try {
      await api.post('/setup/api/runner/run', { id: task.id });
      success(`Task "${task.title}" execution started`);
      await loadQueue();
    } catch (err) {
      notifyError('Failed to run: ' + (err.body || err.message));
    } finally {
      runningTasks.delete(task.id);
      runningTasks = new Set(runningTasks);
    }
  }

  function openEditModal(task) {
    editTask = { ...task };
    editModalOpen = true;
  }

  async function saveEdit() {
    if (!editTask) return;
    editLoading = true;
    try {
      await api.post('/setup/api/runner/edit', {
        id: editTask.id,
        title: editTask.title,
        description: editTask.description,
        priority: editTask.priority,
        project: editTask.project,
      });
      success('Task updated');
      editModalOpen = false;
      await loadQueue();
    } catch (err) {
      notifyError('Failed to update: ' + (err.body || err.message));
    } finally {
      editLoading = false;
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

  async function updateConfig() {
    configLoading = true;
    try {
      await api.post('/setup/api/runner/config', configForm);
      success('Config updated');
      configOpen = false;
      await loadQueue();
    } catch (err) {
      notifyError('Failed to update config: ' + (err.body || err.message));
    } finally {
      configLoading = false;
    }
  }

  async function getSuggestions() {
    suggestLoading = true;
    suggestions = [];
    suggestRaw = '';
    try {
      const data = await api.post('/setup/api/runner/suggest', {
        project: suggestFilter || undefined,
      });
      suggestions = data.suggestions || [];
      suggestRaw = data.raw || '';
    } catch (err) {
      notifyError('Failed to get suggestions: ' + (err.body || err.message));
    } finally {
      suggestLoading = false;
    }
  }

  async function addSuggestion(s) {
    try {
      await api.post('/setup/api/runner/add', {
        project: s.project ? `JW-Flo/${s.project}` : '',
        title: s.title,
        description: s.description || '',
        priority: s.priority || 5,
      });
      success(`Added: ${s.title}`);
      suggestions = suggestions.filter(x => x !== s);
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
      projects = [];
    }
  }

  // Auto-refresh every 30s
  let refreshInterval;
  onMount(() => {
    loadQueue();
    loadProjects();
    refreshInterval = setInterval(loadQueue, 30000);
  });
  onDestroy(() => clearInterval(refreshInterval));

  let sortedTasks = $derived([...tasks].sort((a, b) => (a.priority || 5) - (b.priority || 5)));

  function formatDate(d) {
    if (!d) return '--';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return d; }
  }
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
          Running: <span class="text-accent-2 font-medium">{status.currentTask.title || status.currentTask}</span>
        {:else}
          Idle
        {/if}
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onclick={() => configOpen = !configOpen}>
          Config
        </Button>
        <Button variant="ghost" size="sm" onclick={togglePause}>
          {config.paused ? 'Resume' : 'Pause'}
        </Button>
      </div>
    </div>

    <!-- Config Panel (collapsible) -->
    {#if configOpen}
      <div class="mb-6 p-4 bg-surface border border-border rounded-xl" style="animation: fadeIn 0.2s ease;">
        <h3 class="text-sm font-semibold text-text-2 mb-3">Runner Configuration</h3>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="text-xs text-text-3 mb-1 block">Max Concurrent</label>
            <input type="number" min="1" max="5" bind:value={configForm.maxConcurrent} class="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text w-full focus:border-accent focus:outline-none" />
          </div>
          <div>
            <label class="text-xs text-text-3 mb-1 block">Pause Between (sec)</label>
            <input type="number" min="0" max="3600" bind:value={configForm.pauseBetweenTasks} class="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text w-full focus:border-accent focus:outline-none" />
          </div>
          <div>
            <label class="text-xs text-text-3 mb-1 block">Daily Task Limit</label>
            <input type="number" min="1" max="100" bind:value={configForm.dailyTaskLimit} class="bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text w-full focus:border-accent focus:outline-none" />
          </div>
        </div>
        <div class="mt-3 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onclick={() => configOpen = false}>Cancel</Button>
          <Button variant="primary" size="sm" loading={configLoading} onclick={updateConfig}>Save Config</Button>
        </div>
      </div>
    {/if}

    <!-- Actions -->
    <div class="flex flex-wrap items-center gap-3 mb-6">
      <Button variant="primary" onclick={() => addModalOpen = true}>Add Task</Button>
      <Button variant="secondary" onclick={loadQueue} loading={loading}>Refresh</Button>
      <Button variant="ghost" onclick={runRoadmap} loading={roadmapLoading}>Run Roadmap Planner</Button>
      <div class="ml-auto">
        <Button variant="accent" onclick={getSuggestions} loading={suggestLoading}>
          AI Suggest Tasks
        </Button>
      </div>
    </div>

    <!-- AI Suggestions (if any) -->
    {#if suggestions.length > 0 || suggestRaw}
      <div class="mb-8 p-4 bg-accent/5 border border-accent/20 rounded-xl" style="animation: fadeIn 0.3s ease;">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-accent-2">AI Suggested Tasks</h3>
          <button class="text-xs text-text-3 hover:text-text-2 cursor-pointer" onclick={() => { suggestions = []; suggestRaw = ''; }}>Dismiss</button>
        </div>
        {#if suggestions.length > 0}
          <div class="space-y-3">
            {#each suggestions as s}
              <div class="flex items-start gap-3 p-3 bg-surface rounded-lg border border-border">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-semibold text-text">{s.title}</span>
                    {#if s.project}
                      <Badge variant="info">{s.project}</Badge>
                    {/if}
                    {#if s.estimatedCost}
                      <Badge variant={s.estimatedCost === 'low' ? 'success' : s.estimatedCost === 'high' ? 'danger' : 'warning'}>
                        {s.estimatedCost} cost
                      </Badge>
                    {/if}
                    {#if s.suggestedModel}
                      <span class="text-xs font-mono text-text-3">{s.suggestedModel}</span>
                    {/if}
                  </div>
                  {#if s.description}
                    <p class="text-xs text-text-2 mt-1 line-clamp-2">{s.description}</p>
                  {/if}
                </div>
                <Button variant="primary" size="sm" onclick={() => addSuggestion(s)}>Add</Button>
              </div>
            {/each}
          </div>
        {:else if suggestRaw}
          <CodeOutput content={suggestRaw} visible={true} title="AI Response" maxHeight="300px" />
        {/if}
      </div>
    {/if}

    <!-- Task Queue -->
    <div class="bg-surface border border-border rounded-xl overflow-hidden mb-8">
      <div class="px-4 py-3 border-b border-border bg-surface-2/30">
        <h3 class="text-sm font-semibold text-text-2">Task Queue ({sortedTasks.length})</h3>
      </div>
      {#if sortedTasks.length === 0}
        <div class="text-center py-12 text-text-3 text-sm">
          No tasks in queue. Add tasks, run the Roadmap Planner, or ask AI for suggestions.
        </div>
      {:else}
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50 w-12">#</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">Project</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">Title</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50 w-20">Status</th>
              <th class="text-right px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50 w-48">Actions</th>
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
                    <span class="text-text-3">--</span>
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
                  <div class="flex items-center justify-end gap-1.5">
                    {#if task.status === 'pending'}
                      <Button variant="primary" size="sm" onclick={() => runTask(task)} loading={runningTasks.has(task.id)}>
                        Run
                      </Button>
                    {/if}
                    <Button variant="ghost" size="sm" onclick={() => openEditModal(task)}>Edit</Button>
                    <Button variant="danger" size="sm" onclick={() => removeTask(task.id)}>
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </Button>
                  </div>
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
              {#each history.slice(-20).reverse() as task}
                <tr class="hover:bg-surface-2/30 transition-colors">
                  <td class="px-4 py-3 text-sm font-semibold border-b border-border/50">
                    {task.title}
                    {#if task.result}
                      <details class="mt-1">
                        <summary class="text-xs text-text-3 cursor-pointer hover:text-text-2">View output</summary>
                        <pre class="text-xs text-text-3 mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto font-mono bg-bg p-2 rounded">{task.result}</pre>
                      </details>
                    {/if}
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50">
                    <Badge variant="default">{(task.project || '').split('/').pop() || '--'}</Badge>
                  </td>
                  <td class="px-4 py-3 text-xs text-text-2 border-b border-border/50">{formatDate(task.completedAt)}</td>
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
          <option value="">Any / General</option>
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

  <!-- Edit Task Modal -->
  <Modal bind:open={editModalOpen} title="Edit Task" size="md">
    {#if editTask}
      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium text-text-2 mb-1.5 block">Project</label>
          <select bind:value={editTask.project} class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none appearance-none">
            <option value="">Any / General</option>
            {#each projects as p}
              <option value={p}>{p}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="text-sm font-medium text-text-2 mb-1.5 block">Title</label>
          <input bind:value={editTask.title} type="text" class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none" />
        </div>
        <div>
          <label class="text-sm font-medium text-text-2 mb-1.5 block">Description</label>
          <textarea bind:value={editTask.description} rows="4" class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none resize-y min-h-24"></textarea>
        </div>
        <div>
          <label class="text-sm font-medium text-text-2 mb-1.5 block">Priority (1 = highest)</label>
          <input bind:value={editTask.priority} type="number" min="1" max="10" class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-24 focus:border-accent focus:outline-none" />
        </div>
      </div>
      <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
        <Button variant="secondary" onclick={() => editModalOpen = false}>Cancel</Button>
        <Button variant="primary" onclick={saveEdit} loading={editLoading}>Save Changes</Button>
      </div>
    {/if}
  </Modal>
</div>
