<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { error } from '$lib/stores/notifications.js';
  import Card from '$lib/components/shared/Card.svelte';
  import StatusDot from '$lib/components/shared/StatusDot.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

  // Loading states
  let loadingHealth = $state(true);
  let loadingProjects = $state(true);
  let loadingCron = $state(true);
  let loadingSessions = $state(true);
  let loadingLogs = $state(true);

  // Data
  let health = $state(null);
  let projects = $state([]);
  let cronJobs = $state([]);
  let cronRaw = $state('');
  let cronParseFailed = $state(false);
  let sessionCount = $state(null);
  let sessionsAvailable = $state(true);
  let logLines = $state([]);

  // Derived
  let gatewayUp = $derived(health && health.gateway === 'running');
  let cleanProjects = $derived(projects.filter(p => !p.dirty));
  let dirtyProjects = $derived(projects.filter(p => p.dirty));
  let failingCronCount = $derived(cronJobs.filter(j => j.failing).length);

  async function loadHealth() {
    try {
      const res = await api.get('/setup/healthz');
      health = res;
    } catch {
      health = null;
    } finally {
      loadingHealth = false;
    }
  }

  async function loadProjects() {
    try {
      const res = await api.get('/setup/api/projects/status');
      if (Array.isArray(res)) {
        projects = res;
      } else if (res && Array.isArray(res.projects)) {
        projects = res.projects;
      } else {
        projects = [];
      }
    } catch {
      projects = [];
    } finally {
      loadingProjects = false;
    }
  }

  async function loadCron() {
    try {
      const res = await api.post('/setup/api/openclaw-cmd', { args: ['cron', 'list', '--json'] });
      const output = res.output || '';
      cronRaw = output;
      try {
        const parsed = JSON.parse(output);
        cronJobs = Array.isArray(parsed) ? parsed : (parsed.jobs || parsed.crons || []);
        cronParseFailed = false;
      } catch {
        cronParseFailed = true;
        cronJobs = [];
      }
    } catch {
      cronRaw = '';
      cronJobs = [];
    } finally {
      loadingCron = false;
    }
  }

  async function loadSessions() {
    try {
      const res = await api.post('/setup/api/openclaw-cmd', { args: ['sessions', 'list', '--json'] });
      const output = res.output || '';
      try {
        const parsed = JSON.parse(output);
        sessionCount = Array.isArray(parsed) ? parsed.length : (parsed.sessions ? parsed.sessions.length : 0);
      } catch {
        const lines = output.trim().split('\n').filter(l => l.trim());
        sessionCount = lines.length > 1 ? lines.length - 1 : 0;
      }
    } catch {
      sessionsAvailable = false;
    } finally {
      loadingSessions = false;
    }
  }

  async function loadLogs() {
    try {
      const res = await api.get('/setup/api/debug');
      const output = typeof res === 'string' ? res : (res.output || res.logs || '');
      if (typeof output === 'string') {
        logLines = output.split('\n').filter(l => l.trim()).slice(-20);
      } else if (res.gatewayLogs) {
        const rawLogs = typeof res.gatewayLogs === 'string' ? res.gatewayLogs : JSON.stringify(res.gatewayLogs);
        logLines = rawLogs.split('\n').filter(l => l.trim()).slice(-20);
      } else {
        logLines = [];
      }
    } catch {
      logLines = [];
    } finally {
      loadingLogs = false;
    }
  }

  onMount(() => {
    loadHealth();
    loadProjects();
    loadCron();
    loadSessions();
    loadLogs();
  });
</script>

<div>
  <h1 class="text-2xl font-bold text-text mb-6">Reports & Analytics</h1>

  <!-- Summary row -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
    <!-- Gateway Uptime -->
    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Gateway Uptime</span>
        {#if loadingHealth}
          <Spinner size="sm" />
        {:else}
          <div class="flex items-center gap-2">
            <StatusDot status={gatewayUp ? 'green' : 'red'} pulse={gatewayUp} />
            <span class="text-lg font-bold text-text">{gatewayUp ? 'Running' : 'Down'}</span>
          </div>
          {#if health && health.uptime}
            <span class="text-xs text-text-3">Uptime: {health.uptime}</span>
          {/if}
        {/if}
      </div>
    </Card>

    <!-- Active Projects -->
    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Active Projects</span>
        {#if loadingProjects}
          <Spinner size="sm" />
        {:else}
          <span class="text-lg font-bold text-text">{projects.length}</span>
          <div class="flex items-center gap-3 text-xs text-text-2">
            <span class="text-success">{cleanProjects.length} clean</span>
            {#if dirtyProjects.length > 0}
              <span class="text-warning">{dirtyProjects.length} dirty</span>
            {/if}
          </div>
        {/if}
      </div>
    </Card>

    <!-- Cron Jobs -->
    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Cron Jobs</span>
        {#if loadingCron}
          <Spinner size="sm" />
        {:else}
          <span class="text-lg font-bold text-text">{cronJobs.length}</span>
          {#if cronJobs.length > 0}
            {#if failingCronCount > 0}
              <span class="text-xs text-danger">{failingCronCount} failing</span>
            {:else}
              <span class="text-xs text-success">healthy</span>
            {/if}
          {:else}
            <span class="text-xs text-text-3">No jobs configured</span>
          {/if}
        {/if}
      </div>
    </Card>

    <!-- Agent Sessions -->
    <Card>
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Agent Sessions</span>
        {#if loadingSessions}
          <Spinner size="sm" />
        {:else if !sessionsAvailable}
          <span class="text-lg font-bold text-text-3">N/A</span>
          <span class="text-xs text-text-3">Sessions API unavailable</span>
        {:else}
          <span class="text-lg font-bold text-text">{sessionCount ?? 0}</span>
          <span class="text-xs text-text-2">tracked sessions</span>
        {/if}
      </div>
    </Card>
  </div>

  <!-- Project Health -->
  <div class="mt-8">
    <h2 class="text-lg font-semibold text-text mb-4">Project Health</h2>
    {#if loadingProjects}
      <div class="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    {:else if projects.length === 0}
      <Card>
        <p class="text-sm text-text-3 text-center py-4">No projects found. Sync repos from the Projects page.</p>
      </Card>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        {#each projects as project}
          <Card title={project.name || project.repo || 'Unknown'}>
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-3">
                {#if project.branch}
                  <Badge variant="info">{project.branch}</Badge>
                {/if}
                <StatusDot
                  status={project.dirty ? 'yellow' : 'green'}
                  label={project.dirty ? 'Dirty' : 'Clean'}
                />
              </div>

              {#if project.lastCommit || project.commit}
                <p class="font-mono text-xs text-text-2 truncate">
                  {project.lastCommit || project.commit}
                </p>
              {/if}

              <!-- Status bar -->
              <div class="flex items-center gap-2">
                <div class="flex-1 h-1.5 rounded-full overflow-hidden bg-surface-2">
                  <div
                    class="h-full rounded-full transition-all duration-300 {project.dirty ? 'bg-warning' : 'bg-success'}"
                    style="width: 100%"
                  ></div>
                </div>
                <span class="text-xs text-text-3 whitespace-nowrap">
                  {#if project.dirty}
                    {project.dirtyFiles ?? project.changedFiles ?? '?'} changed
                  {:else}
                    clean
                  {/if}
                </span>
              </div>
            </div>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Scheduled Jobs -->
  <div class="mt-8">
    <h2 class="text-lg font-semibold text-text mb-4">Scheduled Jobs</h2>
    {#if loadingCron}
      <div class="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    {:else if cronParseFailed}
      <Card title="Cron Output (raw)">
        <div class="font-mono text-xs text-text-2 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {cronRaw || 'No cron output available.'}
        </div>
      </Card>
    {:else if cronJobs.length === 0}
      <Card>
        <p class="text-sm text-text-3 text-center py-4">No scheduled jobs configured.</p>
      </Card>
    {:else}
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse">
            <thead>
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                  Job Name
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                  Schedule
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                  Last Status
                </th>
              </tr>
            </thead>
            <tbody>
              {#each cronJobs as job}
                <tr class="group">
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="font-semibold text-text">{job.name || job.id || 'Unnamed'}</span>
                    {#if job.description || job.systemEvent}
                      <p class="text-xs text-text-3 mt-0.5 truncate max-w-xs">{job.description || job.systemEvent}</p>
                    {/if}
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="font-mono text-xs text-text-2">{job.cron || job.schedule || '--'}</span>
                    {#if job.tz || job.timezone}
                      <span class="text-xs text-text-3 ml-1">({job.tz || job.timezone})</span>
                    {/if}
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    {#if job.lastStatus === 'success' || job.lastStatus === 'ok'}
                      <Badge variant="success">Success</Badge>
                    {:else if job.lastStatus === 'failed' || job.lastStatus === 'error' || job.failing}
                      <Badge variant="danger">Failed</Badge>
                    {:else if job.lastStatus === 'running'}
                      <Badge variant="accent">Running</Badge>
                    {:else}
                      <Badge variant="default">{job.lastStatus || 'Pending'}</Badge>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>

  <!-- Recent Activity -->
  <div class="mt-8">
    <h2 class="text-lg font-semibold text-text mb-4">Recent Activity</h2>
    {#if loadingLogs}
      <div class="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    {:else if logLines.length === 0}
      <Card>
        <p class="text-sm text-text-3 text-center py-4">No recent activity logs available.</p>
      </Card>
    {:else}
      <Card>
        <div class="relative pl-6 border-l-2 border-border space-y-3 max-h-96 overflow-y-auto">
          {#each logLines as line, i}
            <div class="relative">
              <!-- Timeline dot -->
              <div class="absolute -left-[25px] top-1.5 w-2 h-2 rounded-full {i === 0 ? 'bg-accent' : 'bg-surface-3'}"></div>
              <p class="font-mono text-xs text-text-2 leading-relaxed break-all">{line}</p>
            </div>
          {/each}
        </div>
      </Card>
    {/if}
  </div>
</div>
