<script>
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { health, connection } from '$lib/stores/health.js';
  import { user, logout } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import { success, error as notifyError } from '$lib/stores/notifications.js';
  import Button from '$lib/components/shared/Button.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';

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
      settings: 'Settings',
    };
    return labels[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
  });

  let gatewayStatus = $derived(
    $health?.gateway === 'running' ? 'green'
    : $health?.gateway === 'starting' ? 'yellow'
    : 'red'
  );

  let isConnected = $derived($connection?.connected || false);
  let gatewayAlive = $derived($connection?.gateway || false);

  function formatUptime(seconds) {
    if (!seconds) return '--';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  }

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

<header class="sticky top-0 h-14 bg-surface/80 backdrop-blur-md border-b border-border px-4 sm:px-6 flex items-center justify-between z-20">
  <!-- Left side: hamburger + breadcrumb -->
  <div class="flex items-center gap-3">
    <button
      class="md:hidden p-1.5 -ml-1.5 rounded-lg text-text-2 hover:text-text hover:bg-surface-2 transition-colors duration-150 cursor-pointer"
      onclick={onToggleSidebar}
      aria-label="Toggle sidebar"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
      </svg>
    </button>

    <nav class="flex items-center gap-1.5 text-sm">
      <span class="text-text-3">Dashboard</span>
      <svg class="w-3.5 h-3.5 text-text-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
      <span class="text-text font-medium">{pageName()}</span>
    </nav>
  </div>

  <!-- Right side: connection + status + actions -->
  <div class="flex items-center gap-2 sm:gap-3">
    <!-- Connection indicator -->
    <div class="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg {isConnected ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}">
      <span
        class="w-1.5 h-1.5 rounded-full flex-shrink-0 {isConnected ? 'bg-success' : 'bg-danger'}"
        class:status-pulse={isConnected}
      ></span>
      <span class="hidden sm:inline font-medium">
        {isConnected ? 'Connected' : 'Disconnected'}
      </span>
    </div>

    <!-- Gateway status -->
    <div class="flex items-center gap-1.5 text-[11px] text-text-3 px-2 py-1 rounded-lg bg-surface-2/50">
      <span
        class="w-1.5 h-1.5 rounded-full flex-shrink-0"
        class:bg-success={gatewayStatus === 'green'}
        class:bg-warning={gatewayStatus === 'yellow'}
        class:bg-danger={gatewayStatus === 'red'}
        class:status-pulse={gatewayStatus === 'yellow'}
      ></span>
      <span class="hidden sm:inline">
        {gatewayStatus === 'green' ? 'Gateway' : gatewayStatus === 'yellow' ? 'Starting' : 'Stopped'}
      </span>
      {#if $connection?.uptime}
        <span class="hidden md:inline text-text-3 ml-0.5">{formatUptime($connection.uptime)}</span>
      {/if}
    </div>

    <!-- Restart -->
    <Button variant="ghost" size="sm" loading={restartLoading} onclick={restartGateway}>
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
      </svg>
      <span class="hidden sm:inline">Restart</span>
    </Button>

    <!-- Doctor -->
    <Button variant="ghost" size="sm" loading={doctorLoading} onclick={runDoctor}>
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17l-5.71 5.71a2.121 2.121 0 01-3-3l5.71-5.71M17.5 6.5l-1.5 1.5m0 0l-3 3m3-3l3-3m-3 3l-3 3m9 1.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
      </svg>
      <span class="hidden md:inline">Doctor</span>
    </Button>

    <!-- User -->
    {#if $user}
      <div class="hidden sm:flex items-center gap-2 pl-2 border-l border-border/50">
        <div class="text-right">
          <span class="text-[11px] font-medium text-text block leading-tight">{$user.displayName || $user.username}</span>
          <span class="text-[10px] text-accent-2/70">{$user.role}</span>
        </div>
        <button
          class="text-text-3 hover:text-text p-1 rounded-lg hover:bg-surface-2 transition-colors cursor-pointer"
          title="Sign out"
          onclick={async () => { await logout(); window.location.href = '/dashboard/login'; }}
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
        </button>
      </div>
    {/if}
  </div>
</header>

<style>
  .status-pulse {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
</style>
