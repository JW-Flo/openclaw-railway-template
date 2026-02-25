<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { error } from '$lib/stores/notifications.js';
  import Card from '$lib/components/shared/Card.svelte';
  import StatusDot from '$lib/components/shared/StatusDot.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';
  import Chart from '$lib/components/shared/Chart.svelte';

  // Loading states
  let loadingHealth = $state(true);
  let loadingProjects = $state(true);
  let loadingCron = $state(true);
  let loadingSessions = $state(true);
  let loadingActivity = $state(true);
  let loadingRunner = $state(true);

  // Data
  let health = $state(null);
  let projects = $state([]);
  let cronJobs = $state([]);
  let cronRaw = $state('');
  let cronParseFailed = $state(false);
  let sessionCount = $state(null);
  let sessionsAvailable = $state(true);
  let activityLog = $state([]);
  let runnerStatus = $state(null);
  let runnerHistory = $state([]);

  // Derived
  let gatewayUp = $derived(health && (health.gatewayRunning || health.gateway === 'running'));
  let cleanProjects = $derived(projects.filter(p => !p.dirty));
  let dirtyProjects = $derived(projects.filter(p => p.dirty));

  // Activity chart data (last 7 days)
  let activityChartData = $derived(() => {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
      const count = activityLog.filter(e => e.ts && e.ts.startsWith(dateStr)).length;
      days.push({ value: count, label: dayLabel, color: 'var(--color-accent-2)' });
    }
    return days;
  });

  // Task completion chart
  let taskChartData = $derived(() => {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
      const completed = runnerHistory.filter(t => t.completedAt && t.completedAt.startsWith(dateStr) && t.status === 'completed').length;
      const failed = runnerHistory.filter(t => t.completedAt && t.completedAt.startsWith(dateStr) && t.status === 'failed').length;
      days.push({ value: completed + failed, label: dayLabel, color: failed > 0 ? 'var(--color-warning)' : 'var(--color-success)' });
    }
    return days;
  });

  async function loadHealth() {
    try { health = await api.get('/setup/healthz'); } catch { health = null; }
    finally { loadingHealth = false; }
  }

  async function loadProjects() {
    try {
      const res = await api.get('/setup/api/projects/status');
      projects = Array.isArray(res) ? res : (res?.projects || []);
    } catch { projects = []; }
    finally { loadingProjects = false; }
  }

  async function loadCron() {
    try {
      const res = await api.post('/setup/api/openclaw-cmd', { args: ['cron', 'list', '--json'] });
      cronRaw = res.output || '';
      try {
        const parsed = JSON.parse(cronRaw);
        cronJobs = Array.isArray(parsed) ? parsed : (parsed.jobs || parsed.crons || []);
        cronParseFailed = false;
      } catch { cronParseFailed = true; cronJobs = []; }
    } catch { cronRaw = ''; cronJobs = []; }
    finally { loadingCron = false; }
  }

  async function loadSessions() {
    try {
      const res = await api.post('/setup/api/openclaw-cmd', { args: ['sessions', '--json'] });
      try {
        const parsed = JSON.parse(res.output || '{}');
        sessionCount = parsed.count ?? (Array.isArray(parsed) ? parsed.length : (parsed.sessions ? parsed.sessions.length : 0));
      } catch { sessionCount = 0; }
    } catch { sessionsAvailable = false; }
    finally { loadingSessions = false; }
  }

  async function loadActivity() {
    try {
      const res = await api.get('/setup/api/activity?limit=200');
      activityLog = res.entries || [];
    } catch { activityLog = []; }
    finally { loadingActivity = false; }
  }

  async function loadRunner() {
    try {
      const [statusRes, histRes] = await Promise.allSettled([
        api.get('/setup/api/runner/status'),
        api.get('/setup/api/runner/history'),
      ]);
      if (statusRes.status === 'fulfilled') runnerStatus = statusRes.value;
      if (histRes.status === 'fulfilled') runnerHistory = histRes.value.history || [];
    } catch { /* ok */ }
    finally { loadingRunner = false; }
  }

  function loadAll() {
    loadHealth(); loadProjects(); loadCron();
    loadSessions(); loadActivity(); loadRunner();
  }

  let refreshInterval;
  onMount(() => { loadAll(); refreshInterval = setInterval(loadAll, 60000); });
  onDestroy(() => clearInterval(refreshInterval));

  function formatActivityType(type) {
    const labels = {
      task_added: 'Task Added', task_started: 'Task Started',
      task_completed: 'Task Completed', task_failed: 'Task Failed',
      gateway_restart: 'Gateway Restart',
    };
    return labels[type] || type;
  }

  function activityColor(type) {
    if (type.includes('fail') || type.includes('error')) return 'bg-danger';
    if (type.includes('complete') || type.includes('success')) return 'bg-success';
    if (type.includes('start') || type.includes('restart')) return 'bg-info';
    return 'bg-accent';
  }
</script>

<div style="animation: fadeIn 0.3s ease;">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-text">Reports & Analytics</h1>
    <button class="text-xs text-text-3 hover:text-text-2 transition-colors cursor-pointer" onclick={loadAll}>Refresh</button>
  </div>

  <!-- Summary row -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Gateway</span>
        {#if loadingHealth}
          <Spinner size="sm" />
        {:else}
          <div class="flex items-center gap-2">
            <StatusDot status={gatewayUp ? 'green' : 'red'} pulse={gatewayUp} />
            <span class="text-lg font-bold text-text">{gatewayUp ? 'Running' : 'Down'}</span>
          </div>
        {/if}
      </div>
    </Card>

    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Projects</span>
        {#if loadingProjects}
          <Spinner size="sm" />
        {:else}
          <span class="text-lg font-bold text-text">{projects.length}</span>
          <div class="flex items-center gap-2 text-xs text-text-2">
            <span class="text-success">{cleanProjects.length} clean</span>
            {#if dirtyProjects.length > 0}
              <span class="text-warning">{dirtyProjects.length} dirty</span>
            {/if}
          </div>
        {/if}
      </div>
    </Card>

    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Tasks Today</span>
        {#if loadingRunner}
          <Spinner size="sm" />
        {:else}
          <span class="text-lg font-bold text-text">{runnerStatus?.tasksToday || 0}</span>
          <span class="text-xs text-text-3">{runnerStatus?.paused ? 'Paused' : 'Active'}</span>
        {/if}
      </div>
    </Card>

    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Sessions</span>
        {#if loadingSessions}
          <Spinner size="sm" />
        {:else if !sessionsAvailable}
          <span class="text-lg font-bold text-text-3">N/A</span>
        {:else}
          <span class="text-lg font-bold text-text">{sessionCount ?? 0}</span>
        {/if}
      </div>
    </Card>
  </div>

  <!-- Charts -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-8">
    <Card title="Activity (7 days)">
      {#if loadingActivity}
        <div class="flex justify-center py-8"><Spinner size="md" /></div>
      {:else}
        <Chart data={activityChartData()} height="120px" />
        <p class="text-xs text-text-3 mt-2">{activityLog.length} total events</p>
      {/if}
    </Card>

    <Card title="Tasks Completed (7 days)">
      {#if loadingRunner}
        <div class="flex justify-center py-8"><Spinner size="md" /></div>
      {:else}
        <Chart data={taskChartData()} height="120px" />
        <p class="text-xs text-text-3 mt-2">{runnerHistory.length} total in history</p>
      {/if}
    </Card>
  </div>

  <!-- Project Health -->
  <div class="mb-8">
    <h2 class="text-lg font-semibold text-text mb-4">Project Health</h2>
    {#if loadingProjects}
      <div class="flex justify-center py-8"><Spinner size="lg" /></div>
    {:else if projects.length === 0}
      <Card><p class="text-sm text-text-3 text-center py-4">No projects found.</p></Card>
    {:else}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {#each projects as project}
          <Card title={project.name || project.repo || 'Unknown'}>
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-2 flex-wrap">
                {#if project.branch}<Badge variant="info">{project.branch}</Badge>{/if}
                <StatusDot status={project.dirty ? 'yellow' : 'green'} label={project.dirty ? 'Dirty' : 'Clean'} />
              </div>
              {#if project.lastCommit || project.commit}
                <p class="font-mono text-xs text-text-2 truncate">{project.lastCommit || project.commit}</p>
              {/if}
            </div>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Cron Jobs -->
  <div class="mb-8">
    <h2 class="text-lg font-semibold text-text mb-4">Scheduled Jobs</h2>
    {#if loadingCron}
      <div class="flex justify-center py-8"><Spinner size="lg" /></div>
    {:else if cronJobs.length === 0}
      <Card><p class="text-sm text-text-3 text-center py-4">No scheduled jobs.</p></Card>
    {:else}
      <div class="bg-surface border border-border rounded-xl overflow-x-auto">
        <table class="w-full border-collapse min-w-[360px]">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase border-b border-border bg-surface-2/50">Name</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase border-b border-border bg-surface-2/50">Schedule</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase border-b border-border bg-surface-2/50">Status</th>
            </tr>
          </thead>
          <tbody>
            {#each cronJobs as job}
              <tr class="hover:bg-surface-2/30 transition-colors">
                <td class="px-4 py-3 text-sm border-b border-border/50 font-semibold">{job.name || job.id || 'Unnamed'}</td>
                <td class="px-4 py-3 text-sm border-b border-border/50 font-mono text-xs text-text-2">{job.cron || job.schedule || '--'}</td>
                <td class="px-4 py-3 text-sm border-b border-border/50">
                  <Badge variant={job.lastStatus === 'success' ? 'success' : job.failing ? 'danger' : 'default'}>{job.lastStatus || 'Pending'}</Badge>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- Activity Timeline -->
  <div>
    <h2 class="text-lg font-semibold text-text mb-4">Activity Timeline</h2>
    {#if loadingActivity}
      <div class="flex justify-center py-8"><Spinner size="lg" /></div>
    {:else if activityLog.length === 0}
      <Card><p class="text-sm text-text-3 text-center py-4">No activity logged yet. Events appear as you use the runner and manage the gateway.</p></Card>
    {:else}
      <Card>
        <div class="relative pl-6 border-l-2 border-border space-y-3 max-h-96 overflow-y-auto">
          {#each activityLog.slice(-30).reverse() as entry}
            <div class="relative">
              <div class="absolute -left-[25px] top-1.5 w-2 h-2 rounded-full {activityColor(entry.type)}"></div>
              <div class="flex items-baseline gap-2 flex-wrap">
                <Badge variant={entry.type.includes('fail') ? 'danger' : entry.type.includes('complete') ? 'success' : 'default'}>
                  {formatActivityType(entry.type)}
                </Badge>
                <span class="text-xs text-text-3">{new Date(entry.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {#if entry.detail?.title}
                <p class="text-xs text-text-2 mt-0.5">{entry.detail.title}{entry.detail.project ? ` (${entry.detail.project})` : ''}</p>
              {/if}
            </div>
          {/each}
        </div>
      </Card>
    {/if}
  </div>
</div>
