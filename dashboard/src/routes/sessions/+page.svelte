<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { success, error as notifyError } from '$lib/stores/notifications.js';
  import Button from '$lib/components/shared/Button.svelte';
  import Badge from '$lib/components/shared/Badge.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';

  let sessions = $state([]);
  let loading = $state(true);
  let refreshing = $state(false);
  let parseMode = $state('json');
  let rawOutput = $state('');
  let errorMessage = $state('');

  // Session detail
  let selectedSession = $state(null);
  let chatMessages = $state([]);
  let chatInput = $state('');
  let sending = $state(false);
  let chatScrollEl = $state(null);
  let streamingText = $state('');

  // New session
  let newSessionId = $state('');
  let showNewSession = $state(false);

  async function loadSessions() {
    try {
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
    if (parseMode !== 'error') success('Sessions refreshed');
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
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return dateStr; }
  }

  function selectSession(session) {
    const id = getSessionId(session);
    selectedSession = { ...session, _id: id };
    chatMessages = [];
    chatInput = '';
    streamingText = '';
  }

  function startNewSession() {
    const id = newSessionId.trim() || `chat-${Date.now()}`;
    selectedSession = { _id: id, status: 'new', _isNew: true };
    chatMessages = [];
    chatInput = '';
    streamingText = '';
    showNewSession = false;
    newSessionId = '';
  }

  function closeDetail() {
    selectedSession = null;
    chatMessages = [];
    streamingText = '';
  }

  async function scrollToBottom() {
    await tick();
    if (chatScrollEl) {
      chatScrollEl.scrollTop = chatScrollEl.scrollHeight;
    }
  }

  async function sendMessage() {
    const msg = chatInput.trim();
    if (!msg || sending) return;

    const sid = selectedSession._id;
    chatMessages = [...chatMessages, { role: 'user', content: msg, ts: new Date().toISOString() }];
    chatInput = '';
    sending = true;
    streamingText = '';
    await scrollToBottom();

    try {
      const response = await fetch('/setup/api/sessions/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, message: msg }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const event = line.slice(7);
            continue;
          }
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                streamingText += data.text;
                await scrollToBottom();
              }
              if (data.code !== undefined) {
                // Done
                if (streamingText.trim()) {
                  chatMessages = [...chatMessages, {
                    role: 'assistant',
                    content: streamingText.trim(),
                    ts: new Date().toISOString(),
                    exitCode: data.code,
                  }];
                }
                streamingText = '';
              }
              if (data.message && !data.text) {
                // Error event
                chatMessages = [...chatMessages, {
                  role: 'system',
                  content: `Error: ${data.message}`,
                  ts: new Date().toISOString(),
                }];
                streamingText = '';
              }
            } catch { /* skip bad JSON */ }
          }
        }
      }

      // Flush any remaining streaming text
      if (streamingText.trim()) {
        chatMessages = [...chatMessages, {
          role: 'assistant',
          content: streamingText.trim(),
          ts: new Date().toISOString(),
        }];
        streamingText = '';
      }
    } catch (err) {
      chatMessages = [...chatMessages, {
        role: 'system',
        content: `Failed to send: ${err.message}`,
        ts: new Date().toISOString(),
      }];
      streamingText = '';
    } finally {
      sending = false;
      await scrollToBottom();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Auto-refresh
  let refreshInterval;
  onMount(() => {
    loadSessions();
    refreshInterval = setInterval(() => {
      if (!selectedSession) loadSessions();
    }, 30000);
  });
  onDestroy(() => clearInterval(refreshInterval));
</script>

<div class="h-full flex flex-col" style="animation: fadeIn 0.3s ease;">
  <!-- Header -->
  <div class="flex items-center justify-between mb-4 flex-shrink-0">
    <div class="flex items-center gap-3">
      {#if selectedSession}
        <button
          class="text-text-3 hover:text-text transition-colors cursor-pointer p-1 rounded-lg hover:bg-surface-2"
          onclick={closeDetail}
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 class="text-xl font-bold text-text">
          <span class="text-text-3 text-sm font-normal mr-2">Session</span>
          <span class="font-mono text-sm">{selectedSession._id}</span>
        </h1>
        <Badge variant={getStatusVariant(getSessionStatus(selectedSession))}>
          {getSessionStatus(selectedSession)}
        </Badge>
      {:else}
        <h1 class="text-2xl font-bold text-text">Agent Sessions</h1>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if !selectedSession}
        <Button variant="primary" onclick={() => showNewSession = true}>
          <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Session
        </Button>
        <Button variant="secondary" loading={refreshing} onclick={refreshSessions}>
          Refresh
        </Button>
      {/if}
    </div>
  </div>

  {#if selectedSession}
    <!-- ═══════ SESSION DETAIL VIEW (Chat Interface) ═══════ -->
    <div class="flex-1 flex flex-col min-h-0 bg-surface border border-border rounded-xl overflow-hidden">
      <!-- Chat messages area -->
      <div
        bind:this={chatScrollEl}
        class="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {#if chatMessages.length === 0 && !streamingText}
          <div class="flex flex-col items-center justify-center h-full text-center py-16">
            <div class="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
              <svg class="w-6 h-6 text-accent-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
            </div>
            <p class="text-text-2 text-sm mb-1">Send a message to interact with this session</p>
            <p class="text-text-3 text-xs font-mono">{selectedSession._id}</p>
          </div>
        {/if}

        {#each chatMessages as msg}
          <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
            <div class="max-w-[85%] sm:max-w-[75%] {msg.role === 'user'
              ? 'bg-accent/15 border-accent/20'
              : msg.role === 'system'
                ? 'bg-danger/10 border-danger/20'
                : 'bg-surface-2 border-border'
            } border rounded-2xl px-4 py-3 {msg.role === 'user' ? 'rounded-br-md' : 'rounded-bl-md'}">
              {#if msg.role !== 'user'}
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="text-[10px] font-semibold uppercase tracking-wider {msg.role === 'system' ? 'text-danger' : 'text-accent-2'}">
                    {msg.role === 'system' ? 'System' : 'JClaw'}
                  </span>
                  {#if msg.exitCode !== undefined}
                    <Badge variant={msg.exitCode === 0 ? 'success' : 'danger'}>
                      exit {msg.exitCode}
                    </Badge>
                  {/if}
                </div>
              {/if}
              <div class="text-sm text-text whitespace-pre-wrap break-words font-mono leading-relaxed">
                {msg.content}
              </div>
              <div class="text-[10px] text-text-3 mt-1.5 {msg.role === 'user' ? 'text-right' : ''}">
                {new Date(msg.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        {/each}

        <!-- Streaming indicator -->
        {#if streamingText}
          <div class="flex justify-start">
            <div class="max-w-[85%] sm:max-w-[75%] bg-surface-2 border border-border rounded-2xl rounded-bl-md px-4 py-3">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-accent-2">JClaw</span>
                <span class="flex gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-accent-2" style="animation: pulse 1s ease-in-out infinite;"></span>
                  <span class="w-1.5 h-1.5 rounded-full bg-accent-2" style="animation: pulse 1s ease-in-out 0.2s infinite;"></span>
                  <span class="w-1.5 h-1.5 rounded-full bg-accent-2" style="animation: pulse 1s ease-in-out 0.4s infinite;"></span>
                </span>
              </div>
              <div class="text-sm text-text whitespace-pre-wrap break-words font-mono leading-relaxed">
                {streamingText}
              </div>
            </div>
          </div>
        {/if}

        <!-- Sending indicator (before streaming starts) -->
        {#if sending && !streamingText}
          <div class="flex justify-start">
            <div class="bg-surface-2 border border-border rounded-2xl rounded-bl-md px-4 py-3">
              <div class="flex items-center gap-2">
                <Spinner size="sm" />
                <span class="text-xs text-text-3">Thinking...</span>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Input area -->
      <div class="border-t border-border bg-surface p-3 flex-shrink-0">
        <div class="flex gap-2 items-end">
          <div class="flex-1 relative">
            <textarea
              bind:value={chatInput}
              onkeydown={handleKeydown}
              placeholder="Send a message..."
              disabled={sending}
              rows="1"
              class="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-text placeholder-text-3
                focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30
                disabled:opacity-50 resize-none transition-all duration-150"
              style="min-height: 44px; max-height: 120px; field-sizing: content;"
            ></textarea>
          </div>
          <button
            onclick={sendMessage}
            disabled={sending || !chatInput.trim()}
            class="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 cursor-pointer
              {chatInput.trim() && !sending
                ? 'bg-accent hover:bg-accent-2 text-white'
                : 'bg-surface-2 text-text-3 cursor-not-allowed'}"
          >
            {#if sending}
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            {:else}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            {/if}
          </button>
        </div>
        <div class="flex items-center justify-between mt-2 px-1">
          <span class="text-[10px] text-text-3">
            Session: <span class="font-mono">{selectedSession._id}</span>
          </span>
          <span class="text-[10px] text-text-3">
            {#if sending}Streaming...{:else}Enter to send, Shift+Enter for newline{/if}
          </span>
        </div>
      </div>
    </div>

  {:else}
    <!-- ═══════ SESSION LIST VIEW ═══════ -->
    {#if loading}
      <div class="flex-1 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    {:else if parseMode === 'json'}
      {#if sessions.length === 0}
        <Card>
          <div class="text-center py-12">
            <div class="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-4">
              <svg class="w-7 h-7 text-text-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <p class="text-text-2 text-sm mb-2">No sessions found</p>
            <p class="text-text-3 text-xs mb-4">Start a new session to chat with JClaw</p>
            <Button variant="primary" onclick={() => showNewSession = true}>
              New Session
            </Button>
          </div>
        </Card>
      {:else}
        <div class="grid gap-3">
          {#each sessions as session}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="bg-surface border border-border rounded-xl p-4 cursor-pointer
                hover:border-accent/30 hover:bg-surface-2/30 transition-all duration-150 group"
              onclick={() => selectSession(session)}
            >
              <div class="flex items-center justify-between gap-4">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                  <div class="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0
                    group-hover:bg-accent/20 transition-colors duration-150">
                    <svg class="w-4 h-4 text-accent-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <div class="min-w-0">
                    <p class="font-mono text-sm text-text truncate">{getSessionId(session)}</p>
                    <p class="text-xs text-text-3 mt-0.5">{formatDate(getSessionCreated(session))}</p>
                  </div>
                </div>
                <div class="flex items-center gap-3 flex-shrink-0">
                  {#if getSessionMessages(session) !== '--'}
                    <span class="text-xs text-text-3">{getSessionMessages(session)} msgs</span>
                  {/if}
                  <Badge variant={getStatusVariant(getSessionStatus(session))}>
                    {getSessionStatus(session)}
                  </Badge>
                  <svg class="w-4 h-4 text-text-3 group-hover:text-accent-2 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else if parseMode === 'raw'}
      <Card>
        <div class="font-mono text-xs text-text-2 whitespace-pre-wrap p-4 max-h-96 overflow-y-auto">
          {rawOutput}
        </div>
      </Card>
    {:else if parseMode === 'error'}
      <Card>
        <div class="text-center py-8">
          <svg class="w-10 h-10 mx-auto text-text-3 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p class="text-sm text-text-2 mb-2">Session listing may not be available</p>
          {#if errorMessage}
            <p class="text-xs text-text-3 font-mono mt-2 max-w-md mx-auto break-all">{errorMessage}</p>
          {/if}
          <div class="mt-4">
            <Button variant="primary" onclick={() => showNewSession = true}>
              Start New Session
            </Button>
          </div>
        </div>
      </Card>
    {/if}
  {/if}

  <!-- New Session Dialog -->
  {#if showNewSession}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onclick={(e) => { if (e.target === e.currentTarget) showNewSession = false; }}>
      <div class="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-sm"
        style="animation: fadeIn 0.15s ease;">
        <div class="px-6 py-4 border-b border-border">
          <h2 class="text-lg font-semibold text-text">New Session</h2>
        </div>
        <div class="px-6 py-4">
          <label class="block text-xs text-text-3 mb-2">Session ID (optional)</label>
          <input
            bind:value={newSessionId}
            placeholder="auto-generated if empty"
            class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text
              placeholder-text-3 focus:outline-none focus:border-accent/50"
            onkeydown={(e) => { if (e.key === 'Enter') startNewSession(); }}
          />
          <p class="text-[10px] text-text-3 mt-2">
            Use an existing session ID to resume, or leave blank for a new session.
          </p>
        </div>
        <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
          <Button variant="ghost" onclick={() => showNewSession = false}>Cancel</Button>
          <Button variant="primary" onclick={startNewSession}>Start Session</Button>
        </div>
      </div>
    </div>
  {/if}
</div>
