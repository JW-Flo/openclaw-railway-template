<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { success, error } from '$lib/stores/notifications.js';
  import Button from '$lib/components/shared/Button.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import CodeOutput from '$lib/components/shared/CodeOutput.svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

  let jobs = $state([]);
  let loading = $state(true);
  let refreshing = $state(false);
  let schedulerStatus = $state('');
  let rawOutput = $state('');
  let parseError = $state(false);
  let operationOutput = $state('');
  let showOutput = $state(false);

  // Run/delete loading states
  let runningJob = $state('');
  let deletingJob = $state('');

  // Add modal state
  let showAddModal = $state(false);
  let addingJob = $state(false);
  let newJob = $state({
    name: '',
    schedule: '0 9 * * *',
    timezone: 'America/New_York',
    description: '',
    timeout: 300,
    session: 'main',
  });

  function resetNewJob() {
    newJob = {
      name: '',
      schedule: '0 9 * * *',
      timezone: 'America/New_York',
      description: '',
      timeout: 300,
      session: 'main',
    };
  }

  async function loadJobs() {
    try {
      const res = await api.post('/setup/api/openclaw-cmd', { args: ['cron', 'list', '--json'] });
      const output = (res.output || '').trim();
      if (output) {
        try {
          const parsed = JSON.parse(output);
          jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || parsed.data || []);
          parseError = false;
          rawOutput = '';
        } catch {
          jobs = [];
          parseError = true;
          rawOutput = output;
        }
      } else {
        jobs = [];
        parseError = false;
        rawOutput = '';
      }
    } catch (e) {
      error('Failed to load cron jobs: ' + e.message);
      jobs = [];
      parseError = true;
      rawOutput = e.body || e.message;
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function loadStatus() {
    try {
      const res = await api.post('/setup/api/openclaw-cmd', { args: ['cron', 'status'] });
      schedulerStatus = (res.output || '').trim();
    } catch {
      schedulerStatus = '';
    }
  }

  async function refreshAll() {
    refreshing = true;
    await Promise.all([loadJobs(), loadStatus()]);
    success('Cron jobs refreshed');
  }

  async function runJob(jobId) {
    runningJob = jobId;
    operationOutput = '';
    showOutput = false;
    try {
      const res = await api.post('/setup/api/openclaw-cmd', { args: ['cron', 'run', jobId] });
      operationOutput = res.output || `Job "${jobId}" triggered.`;
      showOutput = true;
      success(`Cron job "${jobId}" triggered`);
    } catch (e) {
      operationOutput = 'Run failed: ' + (e.body || e.message);
      showOutput = true;
      error('Failed to run cron job: ' + e.message);
    } finally {
      runningJob = '';
    }
  }

  async function deleteJob(jobId) {
    deletingJob = jobId;
    operationOutput = '';
    showOutput = false;
    try {
      const res = await api.post('/setup/api/openclaw-cmd', { args: ['cron', 'rm', jobId] });
      operationOutput = res.output || `Job "${jobId}" deleted.`;
      showOutput = true;
      success(`Cron job "${jobId}" deleted`);
      await loadJobs();
    } catch (e) {
      operationOutput = 'Delete failed: ' + (e.body || e.message);
      showOutput = true;
      error('Failed to delete cron job: ' + e.message);
    } finally {
      deletingJob = '';
    }
  }

  async function addJob() {
    if (!newJob.name.trim() || !newJob.schedule.trim()) return;
    addingJob = true;
    operationOutput = '';
    showOutput = false;
    try {
      const args = [
        'cron', 'add',
        '--name', newJob.name.trim(),
        '--cron', newJob.schedule.trim(),
        '--tz', newJob.timezone,
        '--system-event', newJob.description.trim() || newJob.name.trim(),
        '--timeout-seconds', String(newJob.timeout),
        '--session', newJob.session,
        '--json',
      ];
      const res = await api.post('/setup/api/openclaw-cmd', { args });
      operationOutput = res.output || 'Cron job added successfully.';
      showOutput = true;
      success(`Cron job "${newJob.name}" added`);
      showAddModal = false;
      resetNewJob();
      await loadJobs();
    } catch (e) {
      operationOutput = 'Add failed: ' + (e.body || e.message);
      showOutput = true;
      error('Failed to add cron job: ' + e.message);
    } finally {
      addingJob = false;
    }
  }

  function parseSchedulerBadge(status) {
    if (!status) return { variant: 'default', label: 'Unknown' };
    const lower = status.toLowerCase();
    if (lower.includes('running') || lower.includes('active') || lower.includes('ok')) {
      return { variant: 'success', label: 'Running' };
    }
    if (lower.includes('stopped') || lower.includes('inactive') || lower.includes('disabled')) {
      return { variant: 'danger', label: 'Stopped' };
    }
    if (lower.includes('error') || lower.includes('fail')) {
      return { variant: 'danger', label: 'Error' };
    }
    return { variant: 'default', label: status.slice(0, 30) };
  }

  function getJobId(job) {
    return job.id || job.name || job.jobId || '';
  }

  function getJobName(job) {
    return job.name || job.id || job.jobId || 'unnamed';
  }

  let schedulerBadge = $derived(parseSchedulerBadge(schedulerStatus));

  const TIMEZONES = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'UTC',
    'Europe/London',
  ];

  onMount(() => {
    loadJobs();
    loadStatus();
  });
</script>

<div>
  <h1 class="text-2xl font-bold text-text">Cron Jobs</h1>

  <!-- Action bar -->
  <div class="flex items-center gap-3 mb-6 mt-2">
    <Button variant="primary" onclick={() => { resetNewJob(); showAddModal = true; }}>
      Add Cron Job
    </Button>
    <Button variant="secondary" loading={refreshing} onclick={refreshAll}>
      Refresh
    </Button>
    {#if schedulerStatus}
      <div class="flex items-center gap-2 ml-auto">
        <span class="text-xs text-text-3">Scheduler:</span>
        <Badge variant={schedulerBadge.variant}>{schedulerBadge.label}</Badge>
      </div>
    {/if}
  </div>

  <!-- Cron jobs table -->
  {#if parseError}
    <CodeOutput content={rawOutput} visible={true} title="Cron Jobs (Raw Output)" maxHeight="400px" />
  {:else}
    <div class="bg-surface border border-border rounded-xl overflow-hidden">
      <div class="px-4 py-3 border-b border-border bg-surface-2/50">
        <h2 class="text-xs font-medium text-text-3 uppercase tracking-wider">Scheduled Jobs</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Name
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Schedule
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Timezone
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Session
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Timeout
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {#if loading}
              {#each Array(3) as _, i}
                <tr>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-28" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-24" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-28" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-16" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-12" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                  <td class="px-4 py-3 border-b border-border/50">
                    <div class="h-4 rounded bg-surface-2 w-32" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                  </td>
                </tr>
              {/each}
            {:else if jobs.length === 0}
              <tr>
                <td colspan="6" class="px-4 py-12 text-center text-sm text-text-3">
                  No cron jobs configured. Click "Add Cron Job" to create one.
                </td>
              </tr>
            {:else}
              {#each jobs as job}
                <tr class="group">
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="font-semibold text-text">{getJobName(job)}</span>
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <Badge variant="default">
                      <span class="font-mono text-xs">{job.cron || job.schedule || '--'}</span>
                    </Badge>
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="text-xs text-text-2">{job.tz || job.timezone || 'UTC'}</span>
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    {#if (job.session || 'main') === 'main'}
                      <Badge variant="accent">main</Badge>
                    {:else}
                      <Badge variant="default">{job.session}</Badge>
                    {/if}
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="text-xs text-text-2">{job.timeoutSeconds || job.timeout || '--'}s</span>
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <div class="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={runningJob === getJobId(job)}
                        onclick={() => runJob(getJobId(job))}
                      >
                        Run Now
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={deletingJob === getJobId(job)}
                        onclick={() => deleteJob(getJobId(job))}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- Operation output -->
  <div class="mt-6">
    <CodeOutput content={operationOutput} visible={showOutput} title="Operation Output" />
  </div>
</div>

<!-- Add Cron Job Modal -->
<Modal bind:open={showAddModal} title="Add Cron Job" size="md">
  {#snippet children()}
    <div class="space-y-4">
      <div>
        <label for="cron-name" class="text-sm font-medium text-text-2 mb-1.5 block">Name</label>
        <input
          id="cron-name"
          type="text"
          bind:value={newJob.name}
          placeholder="my-cron-job"
          class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label for="cron-schedule" class="text-sm font-medium text-text-2 mb-1.5 block">Schedule</label>
        <input
          id="cron-schedule"
          type="text"
          bind:value={newJob.schedule}
          placeholder="cron expression"
          class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none font-mono"
        />
        <p class="text-xs text-text-3 mt-1">e.g. "0 9 * * *" = daily at 9 AM</p>
      </div>

      <div>
        <label for="cron-tz" class="text-sm font-medium text-text-2 mb-1.5 block">Timezone</label>
        <select
          id="cron-tz"
          bind:value={newJob.timezone}
          class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none appearance-none"
        >
          {#each TIMEZONES as tz}
            <option value={tz}>{tz}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="cron-desc" class="text-sm font-medium text-text-2 mb-1.5 block">Description</label>
        <textarea
          id="cron-desc"
          bind:value={newJob.description}
          placeholder="What should the agent do?"
          class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none min-h-24 resize-y"
        ></textarea>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="cron-timeout" class="text-sm font-medium text-text-2 mb-1.5 block">Timeout (seconds)</label>
          <input
            id="cron-timeout"
            type="number"
            bind:value={newJob.timeout}
            min="30"
            max="3600"
            class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label for="cron-session" class="text-sm font-medium text-text-2 mb-1.5 block">Session</label>
          <select
            id="cron-session"
            bind:value={newJob.session}
            class="bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-text w-full focus:border-accent focus:outline-none appearance-none"
          >
            <option value="main">main</option>
            <option value="isolated">isolated</option>
          </select>
        </div>
      </div>
    </div>
  {/snippet}

  {#snippet footer()}
    <Button variant="secondary" onclick={() => showAddModal = false}>
      Cancel
    </Button>
    <Button
      variant="primary"
      loading={addingJob}
      onclick={addJob}
      disabled={!newJob.name.trim() || !newJob.schedule.trim()}
    >
      Add Job
    </Button>
  {/snippet}
</Modal>
