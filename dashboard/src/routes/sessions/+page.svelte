<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { success, error } from '$lib/stores/notifications.js';
  import Button from '$lib/components/shared/Button.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import CodeOutput from '$lib/components/shared/CodeOutput.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

  let sessions = $state([]);
  let loading = $state(true);
  let refreshing = $state(false);
  let rawOutput = $state('');
  let parseMode = $state('json'); // 'json' | 'raw' | 'error'
  let errorMessage = $state('');

  async function loadSessions() {
    try {
      // openclaw sessions --json (no 'list' subcommand — it doesn't exist)
      const res = await api.post('/setup/api/openclaw-cmd', { args: ['sessions', '--json'] });
      const output = (res.output || '').trim();
      if (output) {
        try {
          const parsed = JSON.parse(output);
          sessions = Array.isArray(parsed) ? parsed : (parsed.sessions || parsed.data || []);
          parseMode = 'json';
          rawOutput = '';
          errorMessage = '';
        } catch {
          sessions = [];
          parseMode = 'raw';
          rawOutput = output;
          errorMessage = '';
        }
      } else {
        sessions = [];
        parseMode = 'json';
        rawOutput = '';
        errorMessage = '';
      }
    } catch (e) {
      // JSON failed, try plain text
      try {
        const res = await api.post('/setup/api/openclaw-cmd', { args: ['sessions'] });
        const output = (res.output || '').trim();
        if (output) {
          sessions = [];
          parseMode = 'raw';
          rawOutput = output;
          errorMessage = '';
        } else {
          sessions = [];
          parseMode = 'error';
          rawOutput = '';
          errorMessage = e.body || e.message;
        }
      } catch (e2) {
        sessions = [];
        parseMode = 'error';
        rawOutput = '';
        errorMessage = e2.body || e2.message;
      }
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function refreshSessions() {
    refreshing = true;
    await loadSessions();
    if (parseMode !== 'error') {
      success('Sessions refreshed');
    }
  }

  function getStatusVariant(status) {
    if (!status) return 'default';
    const lower = String(status).toLowerCase();
    if (lower.includes('active') || lower.includes('running') || lower.includes('open')) return 'success';
    if (lower.includes('closed') || lower.includes('ended') || lower.includes('finished')) return 'default';
    if (lower.includes('error') || lower.includes('failed')) return 'danger';
    if (lower.includes('idle') || lower.includes('paused')) return 'warning';
    return 'default';
  }

  function formatDate(dateStr) {
    if (!dateStr) return '--';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  }

  function getSessionId(session) {
    return session.id || session.sessionId || session.session_id || '--';
  }

  function getSessionStatus(session) {
    return session.status || session.state || 'unknown';
  }

  function getSessionCreated(session) {
    return session.created || session.createdAt || session.created_at || session.startedAt || session.started_at || '';
  }

  function getSessionMessages(session) {
    const count = session.messages || session.messageCount || session.message_count;
    return count !== undefined && count !== null ? String(count) : '--';
  }

  onMount(() => {
    loadSessions();
  });
</script>

<div>
  <h1 class="text-2xl font-bold text-text mb-6">Agent Sessions</h1>

  <!-- Action bar -->
  <div class="flex items-center gap-3 mb-6">
    <Button variant="secondary" loading={refreshing} onclick={refreshSessions}>
      Refresh
    </Button>
  </div>

  {#if loading}
    <!-- Loading skeleton -->
    <div class="bg-surface border border-border rounded-xl overflow-hidden">
      <div class="px-4 py-3 border-b border-border bg-surface-2/50">
        <h2 class="text-xs font-medium text-text-3 uppercase tracking-wider">Sessions</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Session ID
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Status
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Created
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Messages
              </th>
            </tr>
          </thead>
          <tbody>
            {#each Array(4) as _, i}
              <tr>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-48" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-16" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-28" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 w-12" style="animation: shimmer 1.5s ease-in-out infinite;"></div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {:else if parseMode === 'json'}
    <!-- Structured JSON data -->
    <div class="bg-surface border border-border rounded-xl overflow-hidden">
      <div class="px-4 py-3 border-b border-border bg-surface-2/50">
        <h2 class="text-xs font-medium text-text-3 uppercase tracking-wider">Sessions</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Session ID
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Status
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Created
              </th>
              <th class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50">
                Messages
              </th>
            </tr>
          </thead>
          <tbody>
            {#if sessions.length === 0}
              <tr>
                <td colspan="4" class="px-4 py-12 text-center text-sm text-text-3">
                  No active sessions found.
                </td>
              </tr>
            {:else}
              {#each sessions as session}
                <tr class="group">
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="font-mono text-xs text-text">{getSessionId(session)}</span>
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <Badge variant={getStatusVariant(getSessionStatus(session))}>
                      {getSessionStatus(session)}
                    </Badge>
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="text-xs text-text-2">{formatDate(getSessionCreated(session))}</span>
                  </td>
                  <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                    <span class="text-xs text-text-2">{getSessionMessages(session)}</span>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {:else if parseMode === 'raw'}
    <!-- Raw text output -->
    <CodeOutput content={rawOutput} visible={true} title="Sessions" maxHeight="500px" />
  {:else if parseMode === 'error'}
    <!-- Error / unavailable -->
    <Card>
      <div class="text-center py-6">
        <div class="mb-3">
          <svg class="w-10 h-10 mx-auto text-text-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <p class="text-sm text-text-2 mb-4">
          Session listing may not be available in this JClaw version.
        </p>
        {#if errorMessage}
          <div class="mt-4 text-left">
            <CodeOutput content={errorMessage} visible={true} title="Error Details" maxHeight="200px" />
          </div>
        {/if}
      </div>
    </Card>
  {/if}
</div>
