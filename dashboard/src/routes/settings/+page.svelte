<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { connection } from '$lib/stores/health.js';
  import { success, error as notifyError } from '$lib/stores/notifications.js';
  import Card from '$lib/components/shared/Card.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

  // Tabs
  let activeTab = $state('connection');

  // Connection
  let connectionLoading = $state(true);
  let connData = $state(null);

  // API Tokens
  let tokensLoading = $state(true);
  let tokens = $state([]);
  let createModalOpen = $state(false);
  let createLoading = $state(false);
  let newTokenName = $state('');
  let newTokenScopes = $state(['read', 'write', 'agent']);
  let createdToken = $state(null);
  let copiedToken = $state(false);

  // Ticker config
  let tickerLoading = $state(true);
  let tickerSaving = $state(false);
  let tickerConfig = $state({
    enabled: true,
    speed: 30,
    sources: {
      marketAgents: { enabled: true },
      manual: { enabled: true, items: [] },
    },
  });
  let newTickerItem = $state('');

  // Engine / Runner config
  let runnerLoading = $state(true);
  let runnerSaving = $state(false);
  let runnerConfig = $state({});

  // Scheduler / Model Pool
  let schedulerLoading = $state(true);
  let schedulerSaving = $state(false);
  let schedulerStatus = $state(null);
  let modelPool = $state({ models: [], scheduler: {} });
  let addModelOpen = $state(false);
  let newModel = $state({ id: '', provider: '', tier: 'standard', costPer1kTokens: 0, dailyLimit: 20, priority: 5, minTaskPriority: 1, maxTaskPriority: 10, enabled: true, capabilities: [] });

  // Free Model Scanner
  let scannerLoading = $state(false);
  let scannerResults = $state(null);
  let scannerConfig = $state(null);
  let scannerConfigSaving = $state(false);
  let addingModel = $state(null);
  let blockingModel = $state(null);

  // Users management
  let usersLoading = $state(true);
  let users = $state([]);
  let showCreateUser = $state(false);
  let creatingUser = $state(false);
  let newUser = $state({ username: '', password: '', role: 'read', displayName: '' });

  // Debug info
  let debugLoading = $state(true);
  let debugInfo = $state(null);

  async function loadConnection() {
    connectionLoading = true;
    try { connData = await api.get('/setup/api/connection'); } catch { connData = null; }
    connectionLoading = false;
  }

  async function loadTokens() {
    tokensLoading = true;
    try {
      const res = await api.get('/setup/api/tokens');
      tokens = res.tokens || [];
    } catch { tokens = []; }
    tokensLoading = false;
  }

  async function createToken() {
    if (!newTokenName.trim()) return;
    createLoading = true;
    try {
      const res = await api.post('/setup/api/tokens/create', {
        name: newTokenName.trim(),
        scopes: newTokenScopes,
      });
      createdToken = res.token;
      copiedToken = false;
      success('API token created');
      await loadTokens();
    } catch (err) {
      notifyError('Failed to create token: ' + (err.body || err.message));
    }
    createLoading = false;
  }

  async function revokeToken(id) {
    try {
      await api.post('/setup/api/tokens/revoke', { id });
      success('Token revoked');
      await loadTokens();
    } catch (err) {
      notifyError('Failed to revoke: ' + (err.body || err.message));
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      copiedToken = true;
      success('Token copied to clipboard');
    }).catch(() => notifyError('Failed to copy'));
  }

  async function loadTickerConfig() {
    tickerLoading = true;
    try {
      const res = await api.get('/setup/api/ticker/config');
      tickerConfig = res.config || tickerConfig;
    } catch { /* defaults */ }
    tickerLoading = false;
  }

  async function saveTickerConfig() {
    tickerSaving = true;
    try {
      await api.post('/setup/api/ticker/config', tickerConfig);
      success('Ticker settings saved');
    } catch (err) { notifyError('Failed to save: ' + (err.body || err.message)); }
    tickerSaving = false;
  }

  function addManualItem() {
    const item = newTickerItem.trim();
    if (!item) return;
    if (!tickerConfig.sources.manual) tickerConfig.sources.manual = { enabled: true, items: [] };
    tickerConfig.sources.manual.items = [...(tickerConfig.sources.manual.items || []), item];
    newTickerItem = '';
  }

  function removeManualItem(index) {
    tickerConfig.sources.manual.items = tickerConfig.sources.manual.items.filter((_, i) => i !== index);
  }

  async function loadRunnerConfig() {
    runnerLoading = true;
    try {
      const res = await api.get('/setup/api/runner/queue');
      runnerConfig = res.config || {};
    } catch { runnerConfig = {}; }
    runnerLoading = false;
  }

  async function saveRunnerConfig() {
    runnerSaving = true;
    try {
      await api.post('/setup/api/runner/config', {
        maxConcurrent: runnerConfig.maxConcurrent,
        pauseBetweenTasks: runnerConfig.pauseBetweenTasks,
        dailyTaskLimit: runnerConfig.dailyTaskLimit,
        paused: runnerConfig.paused,
      });
      success('Runner config saved');
    } catch (err) { notifyError('Failed to save: ' + (err.body || err.message)); }
    runnerSaving = false;
  }

  async function loadDebug() {
    debugLoading = true;
    try { debugInfo = await api.get('/setup/api/debug'); } catch { debugInfo = null; }
    debugLoading = false;
  }

  function formatUptime(seconds) {
    if (!seconds) return '--';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${seconds % 60}s`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  async function loadScheduler() {
    schedulerLoading = true;
    try {
      const [poolRes, statusRes] = await Promise.all([
        api.get('/setup/api/scheduler/pool'),
        api.get('/setup/api/scheduler/status'),
      ]);
      modelPool = { models: poolRes.models || [], scheduler: poolRes.scheduler || {} };
      schedulerStatus = statusRes;
    } catch { modelPool = { models: [], scheduler: {} }; schedulerStatus = null; }
    schedulerLoading = false;
  }

  async function saveScheduler() {
    schedulerSaving = true;
    try {
      await api.post('/setup/api/scheduler/pool', modelPool);
      success('Scheduler config saved');
      await loadScheduler();
    } catch (err) { notifyError('Failed to save: ' + (err.body || err.message)); }
    schedulerSaving = false;
  }

  async function toggleScheduler() {
    try {
      const res = await api.post('/setup/api/scheduler/toggle');
      success(res.enabled ? 'Scheduler enabled' : 'Scheduler disabled');
      await loadScheduler();
    } catch (err) { notifyError('Toggle failed: ' + (err.body || err.message)); }
  }

  async function runSchedulerNow() {
    try {
      await api.post('/setup/api/scheduler/run-now');
      success('Scheduler tick triggered');
      setTimeout(loadScheduler, 3000);
    } catch (err) { notifyError('Failed: ' + (err.body || err.message)); }
  }

  function addModel() {
    if (!newModel.id.trim()) return;
    modelPool.models = [...modelPool.models, { ...newModel, usedToday: 0, lastResetDate: '', capabilities: newModel.capabilities.length ? newModel.capabilities : ['code'] }];
    newModel = { id: '', provider: '', tier: 'standard', costPer1kTokens: 0, dailyLimit: 20, priority: 5, minTaskPriority: 1, maxTaskPriority: 10, enabled: true, capabilities: [] };
    addModelOpen = false;
  }

  function removeModel(index) {
    modelPool.models = modelPool.models.filter((_, i) => i !== index);
  }

  async function runScan() {
    scannerLoading = true;
    try {
      const res = await api.post('/setup/api/scanner/scan');
      scannerResults = res;
      success(`Scan complete: ${res.newCandidates} new candidates found`);
    } catch (err) {
      notifyError('Scan failed: ' + (err.body || err.message));
    }
    scannerLoading = false;
  }

  async function loadScannerResults() {
    try {
      const res = await api.get('/setup/api/scanner/results');
      if (res.scannedAt) scannerResults = res;
    } catch { /* no results yet */ }
  }

  async function loadScannerConfig() {
    try {
      const res = await api.get('/setup/api/scanner/config');
      scannerConfig = res.config;
    } catch { /* defaults */ }
  }

  async function saveScannerConfig() {
    if (!scannerConfig) return;
    scannerConfigSaving = true;
    try {
      await api.post('/setup/api/scanner/config', scannerConfig);
      success('Scanner config saved');
    } catch (err) { notifyError('Failed: ' + (err.body || err.message)); }
    scannerConfigSaving = false;
  }

  async function addScannedModel(modelId) {
    addingModel = modelId;
    try {
      await api.post('/setup/api/scanner/add', { modelId });
      success(`Added ${modelId} to pool`);
      await Promise.all([loadScheduler(), loadScannerResults()]);
    } catch (err) {
      notifyError('Failed to add: ' + (err.body || err.message));
    }
    addingModel = null;
  }

  async function blockModel(modelId) {
    blockingModel = modelId;
    try {
      await api.post('/setup/api/scanner/block', { modelId });
      success(`Blocked ${modelId}`);
      if (scannerResults?.models) {
        scannerResults = { ...scannerResults, models: scannerResults.models.filter(m => m.id !== modelId) };
      }
    } catch (err) {
      notifyError('Failed: ' + (err.body || err.message));
    }
    blockingModel = null;
  }

  async function loadUsers() {
    usersLoading = true;
    try {
      const res = await api.get('/setup/api/users');
      users = res.users || [];
    } catch { users = []; }
    usersLoading = false;
  }

  async function createUser() {
    if (!newUser.username.trim() || !newUser.password) return;
    creatingUser = true;
    try {
      await api.post('/setup/api/users/create', {
        username: newUser.username.trim(),
        password: newUser.password,
        role: newUser.role,
        displayName: newUser.displayName.trim() || newUser.username.trim(),
      });
      success('User created');
      newUser = { username: '', password: '', role: 'read', displayName: '' };
      showCreateUser = false;
      await loadUsers();
    } catch (err) {
      notifyError('Create failed: ' + (err.body || err.message));
    }
    creatingUser = false;
  }

  async function updateUserRole(id, role) {
    try {
      await api.post('/setup/api/users/update', { id, role });
      success('Role updated');
      await loadUsers();
    } catch (err) { notifyError('Failed: ' + (err.body || err.message)); }
  }

  async function toggleUserEnabled(id, enabled) {
    try {
      await api.post('/setup/api/users/update', { id, enabled });
      success(enabled ? 'User enabled' : 'User disabled');
      await loadUsers();
    } catch (err) { notifyError('Failed: ' + (err.body || err.message)); }
  }

  async function deleteUser(id) {
    try {
      await api.post('/setup/api/users/delete', { id });
      success('User deleted');
      await loadUsers();
    } catch (err) { notifyError('Failed: ' + (err.body || err.message)); }
  }

  function formatCtx(len) {
    if (!len) return '?';
    if (len >= 1000000) return `${(len / 1000000).toFixed(1)}M`;
    if (len >= 1000) return `${Math.round(len / 1000)}k`;
    return String(len);
  }

  const tabs = [
    { id: 'connection', label: 'Connection', icon: 'wifi' },
    { id: 'scheduler', label: 'Scheduler', icon: 'scheduler' },
    { id: 'tokens', label: 'API Tokens', icon: 'key' },
    { id: 'runner', label: 'Runner', icon: 'cog' },
    { id: 'ticker', label: 'Ticker', icon: 'ticker' },
    { id: 'users', label: 'Users', icon: 'users' },
    { id: 'debug', label: 'Debug', icon: 'bug' },
  ];

  function switchTab(id) {
    activeTab = id;
    if (id === 'connection' && !connData) loadConnection();
    if (id === 'scheduler' && modelPool.models.length === 0) { loadScheduler(); loadScannerResults(); loadScannerConfig(); }
    if (id === 'tokens' && tokens.length === 0) loadTokens();
    if (id === 'runner' && !runnerConfig.maxConcurrent) loadRunnerConfig();
    if (id === 'ticker' && tickerLoading) loadTickerConfig();
    if (id === 'users' && users.length === 0) loadUsers();
    if (id === 'debug' && !debugInfo) loadDebug();
  }

  onMount(() => {
    loadConnection();
    loadTokens();
    loadTickerConfig();
    loadRunnerConfig();
    loadScheduler();
    loadScannerResults();
    loadScannerConfig();
  });
</script>

<div style="animation: fadeIn 0.3s ease;">
  <h1 class="text-2xl font-bold text-text mb-6">Settings</h1>

  <!-- Tab Navigation -->
  <div class="flex gap-1 mb-6 overflow-x-auto pb-1 -mx-1 px-1">
    {#each tabs as tab}
      <button
        class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer whitespace-nowrap
          {activeTab === tab.id
            ? 'bg-accent/10 text-accent-2 border border-accent/20'
            : 'text-text-3 hover:text-text-2 hover:bg-surface-2 border border-transparent'}"
        onclick={() => switchTab(tab.id)}
      >
        {#if tab.icon === 'wifi'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
          </svg>
        {:else if tab.icon === 'key'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
        {:else if tab.icon === 'cog'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077l1.41-.513m14.095-5.13l1.41-.513M5.106 17.785l1.15-.964m11.49-9.642l1.149-.964M7.501 19.795l.75-1.3m7.5-12.99l.75-1.3m-6.063 16.658l.26-1.477m2.605-14.772l.26-1.477m0 17.726l-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205L12 12m6.894 5.785l-1.149-.964M6.256 7.178l-1.15-.964m12.634 12.936l-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495" />
          </svg>
        {:else if tab.icon === 'ticker'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
          </svg>
        {:else if tab.icon === 'scheduler'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        {:else if tab.icon === 'users'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        {:else if tab.icon === 'bug'}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152-6.135 2.21 2.21 0 00-2.084-2.18 23.689 23.689 0 00-9.942 0 2.21 2.21 0 00-2.084 2.18 23.91 23.91 0 01-1.152 6.135A24.078 24.078 0 0112 12.75zM9.75 8.625a3 3 0 013-3h.5a3 3 0 013 3v.375" />
          </svg>
        {/if}
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- ═══════ CONNECTION TAB ═══════ -->
  {#if activeTab === 'connection'}
    {#if connectionLoading}
      <div class="flex justify-center py-12"><Spinner size="lg" /></div>
    {:else}
      <div class="space-y-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <div class="flex flex-col gap-2">
              <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Dashboard</span>
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full {connData?.connected ? 'bg-success' : 'bg-danger'}"
                  style="{connData?.connected ? 'animation: pulse 2s ease-in-out infinite;' : ''}"></span>
                <span class="text-lg font-bold text-text">{connData?.connected ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
          </Card>
          <Card>
            <div class="flex flex-col gap-2">
              <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Gateway</span>
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full {connData?.gateway ? 'bg-success' : 'bg-danger'}"></span>
                <span class="text-lg font-bold text-text">{connData?.gateway ? 'Alive' : 'Down'}</span>
              </div>
            </div>
          </Card>
          <Card>
            <div class="flex flex-col gap-2">
              <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Uptime</span>
              <span class="text-lg font-bold text-text">{formatUptime(connData?.uptime)}</span>
            </div>
          </Card>
          <Card>
            <div class="flex flex-col gap-2">
              <span class="text-xs font-medium text-text-3 uppercase tracking-wider">Memory</span>
              <span class="text-lg font-bold text-text">{connData?.memory ? `${connData.memory} MB` : '--'}</span>
            </div>
          </Card>
        </div>

        <Card title="Connection Details">
          <div class="space-y-0">
            <div class="flex items-center justify-between py-3 border-b border-border/50">
              <span class="text-sm text-text-2">Auth Method</span>
              <span class="text-sm text-text font-mono">Basic Auth (SETUP_PASSWORD)</span>
            </div>
            <div class="flex items-center justify-between py-3 border-b border-border/50">
              <span class="text-sm text-text-2">Server Time</span>
              <span class="text-sm text-text font-mono">{connData?.timestamp ? new Date(connData.timestamp).toLocaleString() : '--'}</span>
            </div>
            <div class="flex items-center justify-between py-3 border-b border-border/50">
              <span class="text-sm text-text-2">Health Poll Interval</span>
              <span class="text-sm text-text-3">30 seconds</span>
            </div>
            <div class="flex items-center justify-between py-3">
              <span class="text-sm text-text-2">Session Type</span>
              <Badge variant="info">Browser (Dashboard)</Badge>
            </div>
          </div>
        </Card>

        <div class="flex justify-end">
          <Button variant="secondary" onclick={loadConnection}>
            <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            Refresh
          </Button>
        </div>
      </div>
    {/if}

  <!-- ═══════ SCHEDULER TAB ═══════ -->
  {:else if activeTab === 'scheduler'}
    {#if schedulerLoading}
      <div class="flex justify-center py-12"><Spinner size="lg" /></div>
    {:else}
      <div class="space-y-6">
        <!-- Status banner -->
        <div class="bg-surface border border-border rounded-2xl p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <span class="w-3 h-3 rounded-full {schedulerStatus?.active ? 'bg-success' : schedulerStatus?.enabled ? 'bg-warning' : 'bg-text-3'}"
                style="{schedulerStatus?.active ? 'animation: pulse 2s ease-in-out infinite;' : ''}"></span>
              <span class="text-sm font-semibold text-text">
                {schedulerStatus?.active ? 'Auto-Scheduler Running' : schedulerStatus?.enabled ? 'Enabled (waiting)' : 'Scheduler Disabled'}
              </span>
              {#if schedulerStatus?.inPauseWindow}
                <Badge variant="warning">In pause window</Badge>
              {/if}
            </div>
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" onclick={runSchedulerNow}>Run Now</Button>
              <Button variant={modelPool.scheduler?.enabled ? 'danger' : 'primary'} size="sm" onclick={toggleScheduler}>
                {modelPool.scheduler?.enabled ? 'Disable' : 'Enable'}
              </Button>
            </div>
          </div>
          {#if schedulerStatus}
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div class="bg-bg rounded-xl p-2.5">
                <div class="text-lg font-bold text-text">{schedulerStatus.pendingTasks}</div>
                <div class="text-[10px] text-text-3 uppercase tracking-wider">Pending</div>
              </div>
              <div class="bg-bg rounded-xl p-2.5">
                <div class="text-lg font-bold text-text">{schedulerStatus.runningTasks}</div>
                <div class="text-[10px] text-text-3 uppercase tracking-wider">Running</div>
              </div>
              <div class="bg-bg rounded-xl p-2.5">
                <div class="text-lg font-bold text-text">{schedulerStatus.tasksToday}/{schedulerStatus.dailyLimit}</div>
                <div class="text-[10px] text-text-3 uppercase tracking-wider">Today</div>
              </div>
              <div class="bg-bg rounded-xl p-2.5">
                <div class="text-lg font-bold text-accent-2">{modelPool.scheduler?.strategy || '--'}</div>
                <div class="text-[10px] text-text-3 uppercase tracking-wider">Strategy</div>
              </div>
            </div>
          {/if}
        </div>

        <!-- Scheduler Settings -->
        <Card title="Scheduler Settings">
          <div class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="text-sm text-text-2 block mb-1">Strategy</label>
                <select
                  bind:value={modelPool.scheduler.strategy}
                  class="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50"
                >
                  <option value="cost-optimized">Cost Optimized (smart routing)</option>
                  <option value="quality-first">Quality First (best model)</option>
                  <option value="cheapest-first">Cheapest First (save money)</option>
                  <option value="round-robin">Round Robin (spread evenly)</option>
                </select>
              </div>
              <div>
                <label class="text-sm text-text-2 block mb-1">Check Interval (seconds)</label>
                <input type="number" min="60" max="86400" bind:value={modelPool.scheduler.intervalSeconds}
                  class="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
              </div>
              <div>
                <label class="text-sm text-text-2 block mb-1">Max Concurrent</label>
                <input type="number" min="1" max="5" bind:value={modelPool.scheduler.maxConcurrent}
                  class="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
              </div>
              <div>
                <label class="text-sm text-text-2 block mb-1">Timezone</label>
                <input type="text" bind:value={modelPool.scheduler.timezone}
                  class="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
              </div>
              <div>
                <label class="text-sm text-text-2 block mb-1">Pause Start (HH:MM)</label>
                <input type="text" placeholder="00:00" bind:value={modelPool.scheduler.pauseStart}
                  class="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50" />
              </div>
              <div>
                <label class="text-sm text-text-2 block mb-1">Pause End (HH:MM)</label>
                <input type="text" placeholder="06:00" bind:value={modelPool.scheduler.pauseEnd}
                  class="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50" />
              </div>
            </div>
            <p class="text-[11px] text-text-3">
              <strong>Cost Optimized:</strong> High-priority tasks (1-3) get premium models, low-priority (7-10) use free/cheap models.
              <strong>Quality First:</strong> Always uses the best available model.
              <strong>Cheapest First:</strong> Always uses the cheapest model.
              <strong>Round Robin:</strong> Spreads tasks evenly across all models.
            </p>
          </div>
        </Card>

        <!-- Model Pool -->
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-text">Model Pool</h2>
          <Button variant="primary" size="sm" onclick={() => addModelOpen = true}>
            <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Model
          </Button>
        </div>

        <div class="space-y-2">
          {#each modelPool.models as model, i}
            <div class="bg-surface border border-border rounded-xl p-4 {!model.enabled ? 'opacity-50' : ''}">
              <div class="flex items-center justify-between gap-3 mb-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="font-mono text-sm text-text font-semibold truncate">{model.id}</span>
                  <Badge variant={model.tier === 'free' ? 'success' : model.tier === 'premium' ? 'warning' : 'info'}>
                    {model.tier}
                  </Badge>
                  {#if !model.enabled}
                    <Badge variant="default">Disabled</Badge>
                  {/if}
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <button
                    class="text-xs text-text-3 hover:text-text cursor-pointer"
                    onclick={() => { model.enabled = !model.enabled; }}
                  >{model.enabled ? 'Disable' : 'Enable'}</button>
                  <button
                    class="text-xs text-danger/70 hover:text-danger cursor-pointer"
                    onclick={() => removeModel(i)}
                  >Remove</button>
                </div>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <div>
                  <span class="text-text-3">Cost:</span>
                  <span class="text-text ml-1">{model.costPer1kTokens === 0 ? 'FREE' : `$${model.costPer1kTokens}/1k`}</span>
                </div>
                <div>
                  <span class="text-text-3">Used:</span>
                  <span class="text-text ml-1">{model.usedToday || 0}/{model.dailyLimit}</span>
                </div>
                <div>
                  <span class="text-text-3">Priority:</span>
                  <span class="text-text ml-1">#{model.priority}</span>
                </div>
                <div>
                  <span class="text-text-3">Tasks:</span>
                  <span class="text-text ml-1">P{model.minTaskPriority}-{model.maxTaskPriority}</span>
                </div>
                <div>
                  <span class="text-text-3">Provider:</span>
                  <span class="text-text ml-1">{model.provider}</span>
                </div>
              </div>
              <!-- Usage bar -->
              <div class="mt-2 h-1.5 bg-bg rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-300 {(model.usedToday || 0) / model.dailyLimit > 0.8 ? 'bg-danger' : 'bg-accent'}"
                  style="width: {Math.min(100, ((model.usedToday || 0) / model.dailyLimit) * 100)}%"
                ></div>
              </div>
            </div>
          {/each}
        </div>

        <!-- ── Free Model Scanner ── -->
        <div class="border-t border-border/50 pt-6 mt-2">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-lg font-semibold text-text flex items-center gap-2">
                <svg class="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                Free Model Scanner
              </h2>
              <p class="text-xs text-text-3 mt-0.5">Discovers performant free models from OpenRouter</p>
            </div>
            <Button variant="primary" size="sm" loading={scannerLoading} onclick={runScan}>
              {scannerLoading ? 'Scanning...' : 'Scan Now'}
            </Button>
          </div>

          {#if scannerResults?.scannedAt}
            <div class="bg-surface border border-border rounded-xl p-3 mb-4">
              <div class="flex items-center justify-between text-xs text-text-3 mb-2">
                <span>Last scan: {formatDate(scannerResults.scannedAt)}</span>
                <span>{scannerResults.totalFreeFound} free models found, {scannerResults.filtered || 0} filtered, {scannerResults.newCandidates} new</span>
              </div>
              <div class="grid grid-cols-3 gap-2 text-center">
                <div class="bg-bg rounded-lg p-2">
                  <div class="text-lg font-bold text-accent-2">{scannerResults.totalFreeFound}</div>
                  <div class="text-[10px] text-text-3 uppercase tracking-wider">Total Free</div>
                </div>
                <div class="bg-bg rounded-lg p-2">
                  <div class="text-lg font-bold text-success">{scannerResults.alreadyInPool}</div>
                  <div class="text-[10px] text-text-3 uppercase tracking-wider">In Pool</div>
                </div>
                <div class="bg-bg rounded-lg p-2">
                  <div class="text-lg font-bold text-warning">{scannerResults.newCandidates}</div>
                  <div class="text-[10px] text-text-3 uppercase tracking-wider">New</div>
                </div>
              </div>
            </div>

            <!-- Top Recommendations -->
            {#if scannerResults.topRecommendations?.length > 0}
              <h3 class="text-sm font-semibold text-text mb-2">Top Recommendations</h3>
              <div class="space-y-2 mb-4">
                {#each scannerResults.topRecommendations as rec}
                  <div class="bg-surface border border-border rounded-xl p-3">
                    <div class="flex items-center justify-between gap-2 mb-1.5">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="font-mono text-sm text-text font-semibold truncate">{rec.id}</span>
                        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-2 flex-shrink-0">
                          Score: {rec.score}
                        </span>
                      </div>
                      <div class="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          class="text-xs px-2 py-1 rounded-lg bg-accent/10 text-accent-2 hover:bg-accent/20 cursor-pointer transition-colors disabled:opacity-40"
                          disabled={addingModel === rec.id}
                          onclick={() => addScannedModel(rec.id)}
                        >{addingModel === rec.id ? 'Adding...' : 'Add to Pool'}</button>
                        <button
                          class="text-xs px-2 py-1 rounded-lg text-text-3 hover:bg-danger/10 hover:text-danger cursor-pointer transition-colors disabled:opacity-40"
                          disabled={blockingModel === rec.id}
                          onclick={() => blockModel(rec.id)}
                        >Block</button>
                      </div>
                    </div>
                    <div class="flex items-center gap-3 text-[11px] text-text-3">
                      {#if rec.name}
                        <span class="truncate max-w-[200px]">{rec.name}</span>
                      {/if}
                      <span>CTX: {formatCtx(rec.contextLength)}</span>
                      {#if rec.maxOutputTokens}
                        <span>Out: {formatCtx(rec.maxOutputTokens)}</span>
                      {/if}
                    </div>
                    {#if rec.reasons?.length > 0}
                      <div class="flex flex-wrap gap-1 mt-1.5">
                        {#each rec.reasons as reason}
                          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-bg text-text-3 border border-border/50">{reason}</span>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-xs text-text-3 italic mb-4">No new candidates found. All qualifying models are already in your pool.</p>
            {/if}
          {:else}
            <div class="bg-bg border border-border/50 rounded-xl p-6 text-center mb-4">
              <svg class="w-8 h-8 text-text-3 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <p class="text-sm text-text-3">No scan results yet</p>
              <p class="text-xs text-text-3/60 mt-1">Click "Scan Now" to discover free models from OpenRouter</p>
            </div>
          {/if}

          <!-- Scanner Settings -->
          {#if scannerConfig}
            <details class="bg-surface border border-border rounded-xl overflow-hidden">
              <summary class="px-4 py-3 cursor-pointer text-sm font-medium text-text-2 hover:text-text transition-colors flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Scanner Settings
              </summary>
              <div class="px-4 pb-4 space-y-3 border-t border-border/50">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                  <div class="flex items-center gap-3">
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" bind:checked={scannerConfig.autoScanEnabled} class="sr-only peer" />
                      <div class="w-9 h-5 bg-border rounded-full peer peer-checked:bg-accent transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
                    </label>
                    <span class="text-sm text-text-2">Auto-scan periodically</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" bind:checked={scannerConfig.autoAddEnabled} class="sr-only peer" />
                      <div class="w-9 h-5 bg-border rounded-full peer peer-checked:bg-accent transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
                    </label>
                    <span class="text-sm text-text-2">Auto-add top models (score 40+)</span>
                  </div>
                  <div>
                    <label class="text-xs text-text-3 block mb-1">Scan Interval (hours)</label>
                    <input type="number" min="1" max="168" bind:value={scannerConfig.autoScanIntervalHours}
                      class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
                  </div>
                  <div>
                    <label class="text-xs text-text-3 block mb-1">Min Context Length</label>
                    <input type="number" min="1000" step="1000" bind:value={scannerConfig.minContextLength}
                      class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
                  </div>
                  <div>
                    <label class="text-xs text-text-3 block mb-1">Max Auto-Add per Scan</label>
                    <input type="number" min="0" max="10" bind:value={scannerConfig.maxAutoAdd}
                      class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
                  </div>
                </div>
                {#if scannerConfig.blocklist?.length > 0}
                  <div>
                    <label class="text-xs text-text-3 block mb-1">Blocked Models ({scannerConfig.blocklist.length})</label>
                    <div class="flex flex-wrap gap-1">
                      {#each scannerConfig.blocklist as blocked}
                        <span class="text-[10px] px-2 py-0.5 rounded-full bg-danger/10 text-danger border border-danger/20 flex items-center gap-1">
                          {blocked}
                          <button class="hover:text-white cursor-pointer" onclick={() => {
                            scannerConfig.blocklist = scannerConfig.blocklist.filter(b => b !== blocked);
                          }}>&times;</button>
                        </span>
                      {/each}
                    </div>
                  </div>
                {/if}
                <div class="flex justify-end">
                  <Button variant="secondary" size="sm" loading={scannerConfigSaving} onclick={saveScannerConfig}>Save Scanner Settings</Button>
                </div>
              </div>
            </details>
          {/if}
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="secondary" onclick={loadScheduler}>Refresh</Button>
          <Button variant="primary" loading={schedulerSaving} onclick={saveScheduler}>Save Scheduler Config</Button>
        </div>
      </div>
    {/if}

    <!-- Add Model Dialog -->
    {#if addModelOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onclick={(e) => { if (e.target === e.currentTarget) addModelOpen = false; }}>
        <div class="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md" style="animation: fadeIn 0.15s ease;">
          <div class="px-6 py-4 border-b border-border">
            <h2 class="text-lg font-semibold text-text">Add Model to Pool</h2>
          </div>
          <div class="px-6 py-4 space-y-3">
            <div>
              <label class="text-xs text-text-3 block mb-1">Model ID</label>
              <input bind:value={newModel.id} placeholder="e.g. openrouter/anthropic/claude-sonnet-4"
                class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-text-3 block mb-1">Provider</label>
                <input bind:value={newModel.provider} placeholder="openrouter"
                  class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50" />
              </div>
              <div>
                <label class="text-xs text-text-3 block mb-1">Tier</label>
                <select bind:value={newModel.tier} class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50">
                  <option value="free">Free</option>
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="text-xs text-text-3 block mb-1">$/1k tokens</label>
                <input type="number" step="0.001" min="0" bind:value={newModel.costPer1kTokens}
                  class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
              </div>
              <div>
                <label class="text-xs text-text-3 block mb-1">Daily Limit</label>
                <input type="number" min="1" max="200" bind:value={newModel.dailyLimit}
                  class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
              </div>
              <div>
                <label class="text-xs text-text-3 block mb-1">Quality Priority</label>
                <input type="number" min="1" max="20" bind:value={newModel.priority}
                  class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-text-3 block mb-1">Min Task Priority</label>
                <input type="number" min="1" max="10" bind:value={newModel.minTaskPriority}
                  class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
              </div>
              <div>
                <label class="text-xs text-text-3 block mb-1">Max Task Priority</label>
                <input type="number" min="1" max="10" bind:value={newModel.maxTaskPriority}
                  class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50" />
              </div>
            </div>
          </div>
          <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
            <Button variant="ghost" onclick={() => addModelOpen = false}>Cancel</Button>
            <Button variant="primary" onclick={addModel}>Add Model</Button>
          </div>
        </div>
      </div>
    {/if}

  <!-- ═══════ API TOKENS TAB ═══════ -->
  {:else if activeTab === 'tokens'}
    <div class="space-y-6">
      <!-- Info banner -->
      <div class="bg-accent/5 border border-accent/20 rounded-xl p-4">
        <h3 class="text-sm font-semibold text-accent-2 mb-2">Connect Your Local AI</h3>
        <p class="text-xs text-text-2 mb-3">
          Create API tokens to connect your local AI builds to JClaw. Use these tokens to authenticate
          requests to the external API endpoints.
        </p>
        <div class="bg-bg rounded-lg p-3 font-mono text-[11px] text-text-3 overflow-x-auto">
          <div class="text-text-3 mb-1"># Example: Send a message to JClaw from your local AI</div>
          <div class="text-success">curl -N -X POST \</div>
          <div class="text-success pl-4">-H "Authorization: Bearer jclaw_YOUR_TOKEN" \</div>
          <div class="text-success pl-4">-H "Content-Type: application/json" \</div>
          <div class="text-success pl-4">-d '&#123;"message":"Hello","sessionId":"local-1"&#125;' \</div>
          <div class="text-success pl-4">https://YOUR_DOMAIN/api/v1/agent/message</div>
          <div class="text-text-3 mt-2"># Available endpoints:</div>
          <div class="text-info">GET  /api/v1/health  <span class="text-text-3"># Health check</span></div>
          <div class="text-info">GET  /api/v1/status  <span class="text-text-3"># Runner status & task counts</span></div>
          <div class="text-info">POST /api/v1/agent/message  <span class="text-text-3"># Send message (SSE streaming)</span></div>
          <div class="text-info">POST /api/v1/tasks/add  <span class="text-text-3"># Add task to queue</span></div>
          <div class="text-info">GET  /api/v1/tasks  <span class="text-text-3"># List queued tasks</span></div>
        </div>
      </div>

      <!-- Token list -->
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-text">API Tokens</h2>
        <Button variant="primary" onclick={() => { createModalOpen = true; createdToken = null; newTokenName = ''; }}>
          <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Create Token
        </Button>
      </div>

      {#if tokensLoading}
        <div class="flex justify-center py-8"><Spinner size="lg" /></div>
      {:else if tokens.length === 0}
        <Card>
          <div class="text-center py-8">
            <svg class="w-10 h-10 mx-auto text-text-3 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
            <p class="text-sm text-text-2 mb-1">No API tokens yet</p>
            <p class="text-xs text-text-3">Create a token to connect your local AI to JClaw</p>
          </div>
        </Card>
      {:else}
        <div class="space-y-2">
          {#each tokens as token}
            <div class="bg-surface border border-border rounded-xl p-4 flex items-center justify-between gap-4">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-sm font-semibold text-text">{token.name}</span>
                  {#if token.revoked}
                    <Badge variant="danger">Revoked</Badge>
                  {:else}
                    <Badge variant="success">Active</Badge>
                  {/if}
                </div>
                <div class="flex items-center gap-3 text-xs text-text-3 flex-wrap">
                  <span class="font-mono">{token.token}</span>
                  <span>Created {formatDate(token.createdAt)}</span>
                  {#if token.lastUsed}
                    <span>Last used {formatDate(token.lastUsed)}</span>
                  {/if}
                </div>
                {#if token.scopes}
                  <div class="flex gap-1 mt-1.5">
                    {#each token.scopes as scope}
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-3">{scope}</span>
                    {/each}
                  </div>
                {/if}
              </div>
              {#if !token.revoked}
                <Button variant="danger" size="sm" onclick={() => revokeToken(token.id)}>
                  Revoke
                </Button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

  <!-- ═══════ RUNNER CONFIG TAB ═══════ -->
  {:else if activeTab === 'runner'}
    {#if runnerLoading}
      <div class="flex justify-center py-12"><Spinner size="lg" /></div>
    {:else}
      <div class="space-y-6">
        <Card title="Runner Configuration">
          <div class="space-y-5">
            <div>
              <label class="text-sm text-text-2 block mb-1">Max Concurrent Tasks</label>
              <input
                type="number"
                min="1"
                max="5"
                bind:value={runnerConfig.maxConcurrent}
                class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text
                  focus:outline-none focus:border-accent/50"
              />
              <p class="text-[11px] text-text-3 mt-1">Maximum number of tasks running simultaneously</p>
            </div>

            <div>
              <label class="text-sm text-text-2 block mb-1">Pause Between Tasks (seconds)</label>
              <input
                type="number"
                min="0"
                max="3600"
                bind:value={runnerConfig.pauseBetweenTasks}
                class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text
                  focus:outline-none focus:border-accent/50"
              />
              <p class="text-[11px] text-text-3 mt-1">Cool-down between task executions</p>
            </div>

            <div>
              <label class="text-sm text-text-2 block mb-1">Daily Task Limit</label>
              <input
                type="number"
                min="1"
                max="100"
                bind:value={runnerConfig.dailyTaskLimit}
                class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text
                  focus:outline-none focus:border-accent/50"
              />
              <p class="text-[11px] text-text-3 mt-1">Maximum tasks to execute per day</p>
            </div>

            <div class="flex items-center justify-between pt-2">
              <div>
                <p class="text-sm text-text font-medium">Runner Paused</p>
                <p class="text-xs text-text-3 mt-0.5">When paused, no tasks will be auto-executed</p>
              </div>
              <button
                class="relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer
                  {runnerConfig.paused ? 'bg-warning' : 'bg-success'}"
                onclick={() => runnerConfig.paused = !runnerConfig.paused}
              >
                <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                  {runnerConfig.paused ? 'translate-x-5' : ''}"></span>
              </button>
            </div>
          </div>
        </Card>

        <Card title="Engine Configuration">
          <div class="space-y-3">
            <div class="flex items-center justify-between py-2 border-b border-border/50">
              <div>
                <p class="text-sm text-text">Default Engine</p>
                <p class="text-[11px] text-text-3">openclaw</p>
              </div>
              <Badge variant="success">Enabled</Badge>
            </div>
            <div class="flex items-center justify-between py-2 border-b border-border/50">
              <span class="text-sm text-text-2">Model</span>
              <span class="text-sm text-text font-mono">{runnerConfig.engines?.openclaw?.model || 'xai/grok-4'}</span>
            </div>
            <div class="flex items-center justify-between py-2">
              <span class="text-sm text-text-2">Agent Timeout</span>
              <span class="text-sm text-text">{runnerConfig.engines?.openclaw?.timeout || 180}s</span>
            </div>
          </div>
        </Card>

        <div class="flex justify-end">
          <Button variant="primary" loading={runnerSaving} onclick={saveRunnerConfig}>
            Save Runner Config
          </Button>
        </div>
      </div>
    {/if}

  <!-- ═══════ TICKER TAB ═══════ -->
  {:else if activeTab === 'ticker'}
    {#if tickerLoading}
      <div class="flex justify-center py-12"><Spinner size="lg" /></div>
    {:else}
      <div class="space-y-6">
        <Card title="Ticker Settings">
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-text font-medium">Enable Ticker</p>
                <p class="text-xs text-text-3 mt-0.5">Show scrolling news banner on the dashboard</p>
              </div>
              <button
                class="relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer
                  {tickerConfig.enabled ? 'bg-accent' : 'bg-surface-2 border border-border'}"
                onclick={() => tickerConfig.enabled = !tickerConfig.enabled}
              >
                <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                  {tickerConfig.enabled ? 'translate-x-5' : ''}"></span>
              </button>
            </div>

            <div>
              <label class="text-sm text-text-2 block mb-1">Scroll Speed ({tickerConfig.speed}s per cycle)</label>
              <input type="range" min="5" max="120" step="5" bind:value={tickerConfig.speed} class="w-full accent-accent" />
              <div class="flex justify-between text-xs text-text-3 mt-1">
                <span>Fast</span><span>Slow</span>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Data Sources">
          <div class="space-y-4">
            <div class="flex items-center justify-between py-2 border-b border-border/50">
              <div class="flex items-center gap-3">
                <span class="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
                  <svg class="w-4 h-4 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                  </svg>
                </span>
                <div>
                  <p class="text-sm text-text">Market Agents</p>
                  <p class="text-[11px] text-text-3">Trades, signals, positions from market_agents</p>
                </div>
              </div>
              <button
                class="relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer
                  {tickerConfig.sources?.marketAgents?.enabled ? 'bg-accent' : 'bg-surface-2 border border-border'}"
                onclick={() => {
                  if (!tickerConfig.sources.marketAgents) tickerConfig.sources.marketAgents = { enabled: false };
                  tickerConfig.sources.marketAgents.enabled = !tickerConfig.sources.marketAgents.enabled;
                }}
              >
                <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                  {tickerConfig.sources?.marketAgents?.enabled ? 'translate-x-5' : ''}"></span>
              </button>
            </div>

            <div>
              <div class="flex items-center justify-between mb-3">
                <p class="text-sm text-text">Manual Headlines</p>
                <button
                  class="relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer
                    {tickerConfig.sources?.manual?.enabled ? 'bg-accent' : 'bg-surface-2 border border-border'}"
                  onclick={() => {
                    if (!tickerConfig.sources.manual) tickerConfig.sources.manual = { enabled: false, items: [] };
                    tickerConfig.sources.manual.enabled = !tickerConfig.sources.manual.enabled;
                  }}
                >
                  <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                    {tickerConfig.sources?.manual?.enabled ? 'translate-x-5' : ''}"></span>
                </button>
              </div>
              <div class="flex gap-2 mb-2">
                <input bind:value={newTickerItem} placeholder="Add headline..." class="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50"
                  onkeydown={(e) => { if (e.key === 'Enter') addManualItem(); }} />
                <Button variant="secondary" onclick={addManualItem}>Add</Button>
              </div>
              {#if tickerConfig.sources?.manual?.items?.length > 0}
                <div class="space-y-1">
                  {#each tickerConfig.sources.manual.items as item, i}
                    <div class="flex items-center justify-between gap-2 px-3 py-2 bg-bg rounded-lg group">
                      <span class="text-xs text-text-2 truncate">{item}</span>
                      <button class="text-text-3 hover:text-danger transition-colors cursor-pointer opacity-0 group-hover:opacity-100 flex-shrink-0" onclick={() => removeManualItem(i)}>
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        </Card>

        <div class="flex justify-end">
          <Button variant="primary" loading={tickerSaving} onclick={saveTickerConfig}>Save Ticker Settings</Button>
        </div>
      </div>
    {/if}

  <!-- ═══════ USERS / IAM TAB ═══════ -->
  {:else if activeTab === 'users'}
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-text">Identity & Access Management</h2>
          <p class="text-xs text-text-3 mt-0.5">Manage dashboard users and their permissions</p>
        </div>
        <Button variant="primary" size="sm" onclick={() => showCreateUser = true}>
          <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add User
        </Button>
      </div>

      <!-- Role legend -->
      <div class="bg-accent/5 border border-accent/20 rounded-xl p-3">
        <h3 class="text-xs font-semibold text-accent-2 mb-2">Role Permissions</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
          <div><Badge variant="default">Limited Read</Badge> <span class="text-text-3 ml-1">Overview, Projects, Models only</span></div>
          <div><Badge variant="info">Read</Badge> <span class="text-text-3 ml-1">View all pages</span></div>
          <div><Badge variant="info">Read & Write</Badge> <span class="text-text-3 ml-1">View + edit projects, sessions, runner</span></div>
          <div><Badge variant="warning">Admin</Badge> <span class="text-text-3 ml-1">Manage skills, tools, models, scheduler</span></div>
          <div><Badge variant="danger">Super Admin</Badge> <span class="text-text-3 ml-1">Gateway, config, all management</span></div>
          <div><Badge variant="success">Owner</Badge> <span class="text-text-3 ml-1">Full access, all permissions</span></div>
        </div>
      </div>

      <!-- User list -->
      {#if usersLoading}
        <div class="flex justify-center py-8"><Spinner size="lg" /></div>
      {:else}
        <div class="space-y-2">
          {#each users as u}
            <div class="bg-surface border border-border rounded-xl p-4 {!u.enabled ? 'opacity-50' : ''}">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0 text-accent-2 text-sm font-bold">
                    {(u.displayName || u.username || '?')[0].toUpperCase()}
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-semibold text-sm text-text">{u.displayName || u.username}</span>
                      <span class="text-[10px] font-mono text-text-3">@{u.username}</span>
                    </div>
                    <div class="flex items-center gap-2 mt-0.5">
                      <select
                        value={u.role}
                        onchange={(e) => updateUserRole(u.id, e.target.value)}
                        class="bg-bg border border-border rounded-lg px-2 py-0.5 text-[11px] text-text focus:outline-none focus:border-accent/50 cursor-pointer"
                      >
                        <option value="limited-read">Limited Read</option>
                        <option value="read">Read</option>
                        <option value="read-write">Read & Write</option>
                        <option value="admin">Admin</option>
                        <option value="super-admin">Super Admin</option>
                        <option value="owner">Owner</option>
                      </select>
                      {#if u.lastLoginAt}
                        <span class="text-[10px] text-text-3">Last login: {formatDate(u.lastLoginAt)}</span>
                      {:else}
                        <span class="text-[10px] text-text-3">Never logged in</span>
                      {/if}
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <button
                    class="text-xs text-text-3 hover:text-text cursor-pointer"
                    onclick={() => toggleUserEnabled(u.id, !u.enabled)}
                  >{u.enabled ? 'Disable' : 'Enable'}</button>
                  {#if u.username !== 'owner'}
                    <button
                      class="text-xs text-danger/70 hover:text-danger cursor-pointer"
                      onclick={() => deleteUser(u.id)}
                    >Delete</button>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>

        {#if users.length === 0}
          <div class="text-center py-8 text-text-3 text-sm">No users found</div>
        {/if}
      {/if}

      <div class="flex justify-end">
        <Button variant="secondary" onclick={loadUsers}>Refresh</Button>
      </div>
    </div>

    <!-- Create User Dialog -->
    {#if showCreateUser}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onclick={(e) => { if (e.target === e.currentTarget) showCreateUser = false; }}>
        <div class="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-sm" style="animation: fadeIn 0.15s ease;">
          <div class="px-6 py-4 border-b border-border">
            <h2 class="text-lg font-semibold text-text">Add User</h2>
          </div>
          <div class="px-6 py-4 space-y-3">
            <div>
              <label class="text-xs text-text-3 block mb-1">Username</label>
              <input bind:value={newUser.username} placeholder="johndoe"
                class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label class="text-xs text-text-3 block mb-1">Display Name</label>
              <input bind:value={newUser.displayName} placeholder="John Doe"
                class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label class="text-xs text-text-3 block mb-1">Password</label>
              <input bind:value={newUser.password} type="password" placeholder="strong password"
                class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-3 focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label class="text-xs text-text-3 block mb-1">Role</label>
              <select bind:value={newUser.role}
                class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50">
                <option value="limited-read">Limited Read</option>
                <option value="read">Read</option>
                <option value="read-write">Read & Write</option>
                <option value="admin">Admin</option>
                <option value="super-admin">Super Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>
          <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
            <Button variant="ghost" onclick={() => showCreateUser = false}>Cancel</Button>
            <Button variant="primary" loading={creatingUser} onclick={createUser}>Create User</Button>
          </div>
        </div>
      </div>
    {/if}

  <!-- ═══════ DEBUG TAB ═══════ -->
  {:else if activeTab === 'debug'}
    {#if debugLoading}
      <div class="flex justify-center py-12"><Spinner size="lg" /></div>
    {:else}
      <div class="space-y-6">
        <Card title="System Information">
          {#if debugInfo}
            <div class="font-mono text-xs whitespace-pre-wrap text-text-2 max-h-96 overflow-y-auto bg-bg rounded-lg p-4">
              {JSON.stringify(debugInfo, null, 2)}
            </div>
          {:else}
            <p class="text-sm text-text-3 text-center py-4">Failed to load debug info</p>
          {/if}
        </Card>
        <div class="flex justify-end">
          <Button variant="secondary" onclick={loadDebug}>Refresh Debug Info</Button>
        </div>
      </div>
    {/if}
  {/if}

  <!-- Create Token Modal -->
  <Modal bind:open={createModalOpen} title={createdToken ? 'Token Created' : 'Create API Token'} size="md">
    {#if createdToken}
      <!-- Show the created token -->
      <div class="space-y-4">
        <div class="bg-warning/10 border border-warning/20 rounded-lg p-3">
          <p class="text-xs text-warning font-semibold mb-1">Copy this token now!</p>
          <p class="text-[11px] text-text-3">You won't be able to see it again after closing this dialog.</p>
        </div>

        <div>
          <label class="text-xs text-text-3 block mb-1">Token Name</label>
          <p class="text-sm text-text font-semibold">{createdToken.name}</p>
        </div>

        <div>
          <label class="text-xs text-text-3 block mb-1">API Token</label>
          <div class="flex gap-2">
            <code class="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-xs text-success font-mono break-all select-all">
              {createdToken.token}
            </code>
            <Button variant="secondary" size="sm" onclick={() => copyToClipboard(createdToken.token)}>
              {copiedToken ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>

        <div>
          <label class="text-xs text-text-3 block mb-1">Scopes</label>
          <div class="flex gap-1">
            {#each createdToken.scopes as scope}
              <Badge variant="info">{scope}</Badge>
            {/each}
          </div>
        </div>
      </div>

      {#snippet footer()}
        <Button variant="primary" onclick={() => { createModalOpen = false; createdToken = null; }}>Done</Button>
      {/snippet}
    {:else}
      <!-- Create form -->
      <div class="space-y-4">
        <div>
          <label class="text-xs text-text-3 block mb-1">Token Name</label>
          <input
            bind:value={newTokenName}
            placeholder="e.g. Local AI Server, Development, etc."
            class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text
              placeholder-text-3 focus:outline-none focus:border-accent/50"
          />
        </div>

        <div>
          <label class="text-xs text-text-3 block mb-2">Scopes</label>
          <div class="space-y-2">
            {#each [
              { id: 'read', label: 'Read', desc: 'View health, status, tasks' },
              { id: 'write', label: 'Write', desc: 'Add/modify tasks, update config' },
              { id: 'agent', label: 'Agent', desc: 'Send messages to agent sessions' },
            ] as scope}
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newTokenScopes.includes(scope.id)}
                  onchange={(e) => {
                    if (e.target.checked) {
                      newTokenScopes = [...newTokenScopes, scope.id];
                    } else {
                      newTokenScopes = newTokenScopes.filter(s => s !== scope.id);
                    }
                  }}
                  class="accent-accent w-4 h-4"
                />
                <div>
                  <span class="text-sm text-text">{scope.label}</span>
                  <span class="text-xs text-text-3 ml-2">{scope.desc}</span>
                </div>
              </label>
            {/each}
          </div>
        </div>
      </div>

      {#snippet footer()}
        <Button variant="ghost" onclick={() => createModalOpen = false}>Cancel</Button>
        <Button variant="primary" loading={createLoading} onclick={createToken}>Create Token</Button>
      {/snippet}
    {/if}
  </Modal>
</div>
