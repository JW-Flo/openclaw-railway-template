<script>
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { health } from '$lib/stores/health.js';
  import { api } from '$lib/api/client.js';
  import { success, error as notifyError } from '$lib/stores/notifications.js';
  import Button from '$lib/components/shared/Button.svelte';

  let { onToggleSidebar = () => {} } = $props();

  let restartLoading = $state(false);
  let doctorLoading = $state(false);

  let pageName = $derived(() => {
    const path = $page.url.pathname.replace(base, '').replace(/^\//, '') || 'overview';
    const segment = path.split('/')[0];
    const labels = {
      overview: 'Overview',
      projects: 'Projects',
      models: 'Models',
      skills: 'Skills',
      tools: 'Tools',
      cron: 'Cron Jobs',
      sessions: 'Sessions',
      reports: 'Reports',
      runner: 'Runner',
    };
    return labels[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
  });

  let gatewayStatus = $derived(
    $health?.gateway === 'running' ? 'green'
    : $health?.gateway === 'starting' ? 'yellow'
    : 'red'
  );

  let gatewayRunning = $derived($health?.gateway === 'running');

  async function restartGateway() {
    restartLoading = true;
    try {
      await api.post('/setup/api/restart-gateway');
      success('Gateway restart initiated');
    } catch (err) {
      notifyError('Failed to restart gateway: ' + (err.body || err.message));
    } finally {
      restartLoading = false;
    }
  }

  async function runDoctor() {
    doctorLoading = true;
    try {
      await api.post('/setup/api/doctor');
      success('Doctor completed successfully');
    } catch (err) {
      notifyError('Doctor failed: ' + (err.body || err.message));
    } finally {
      doctorLoading = false;
    }
  }
</script>

<header class="sticky top-0 h-14 bg-surface/80 backdrop-blur-md border-b border-border px-6 flex items-center justify-between z-20">
  <!-- Left side: hamburger + breadcrumb -->
  <div class="flex items-center gap-3">
    <!-- Mobile hamburger -->
    <button
      class="md:hidden p-1.5 -ml-1.5 rounded-lg text-text-2 hover:text-text hover:bg-surface-2 transition-colors duration-150 cursor-pointer"
      onclick={onToggleSidebar}
      aria-label="Toggle sidebar"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
      </svg>
    </button>

    <!-- Breadcrumb -->
    <nav class="flex items-center gap-1.5 text-sm">
      <span class="text-text-3">Dashboard</span>
      <svg class="w-3.5 h-3.5 text-text-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
      <span class="text-text font-medium">{pageName()}</span>
    </nav>
  </div>

  <!-- Right side: status + actions -->
  <div class="flex items-center gap-3">
    <!-- Gateway status dot -->
    <div class="flex items-center gap-2 text-xs text-text-3 mr-1">
      <span
        class="w-2 h-2 rounded-full flex-shrink-0"
        class:bg-success={gatewayStatus === 'green'}
        class:bg-warning={gatewayStatus === 'yellow'}
        class:bg-danger={gatewayStatus === 'red'}
        class:status-pulse={gatewayStatus === 'yellow'}
      ></span>
      <span class="hidden sm:inline">
        {gatewayStatus === 'green' ? 'Running' : gatewayStatus === 'yellow' ? 'Starting' : 'Stopped'}
      </span>
    </div>

    <!-- Restart Gateway button -->
    <Button variant="ghost" size="sm" loading={restartLoading} onclick={restartGateway}>
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
      </svg>
      <span class="hidden sm:inline">Restart</span>
    </Button>

    <!-- Doctor button -->
    <Button variant="ghost" size="sm" loading={doctorLoading} onclick={runDoctor}>
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17l-5.71 5.71a2.121 2.121 0 01-3-3l5.71-5.71M17.5 6.5l-1.5 1.5m0 0l-3 3m3-3l3-3m-3 3l-3 3m9 1.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
      </svg>
      <span class="hidden sm:inline">Doctor</span>
    </Button>
  </div>
</header>

<style>
  .status-pulse {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
</style>
