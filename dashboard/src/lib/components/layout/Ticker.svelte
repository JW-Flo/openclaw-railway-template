<script>
  import { api } from '$lib/api/client.js';
  import { onMount, onDestroy } from 'svelte';

  const ALLOWED_TYPES = { signal: 1, trade: 1, position: 1, info: 1, headline: 1, status: 1 };
  const DEFAULT_HEADLINES = [
    { type: 'headline', text: 'JClaw Command Center \u2014 AI-Powered DevOps & Market Intelligence' },
    { type: 'status', text: 'System Online \u2014 All Services Operational' },
    { type: 'info', text: 'Market Agents \u2014 Automated Trading & Signal Detection Active' },
    { type: 'info', text: 'OpenClaw Gateway \u2014 Multi-Model AI Routing Enabled' },
    { type: 'status', text: 'Railway Deployment \u2014 Auto-Deploy from Main Branch' },
    { type: 'headline', text: 'Dashboard Tip: Press Ctrl+K for Command Palette' },
  ];
  const STORAGE_KEY = 'jclaw-ticker-hidden';
  const REFRESH_MS = 120_000;

  let items = $state([...DEFAULT_HEADLINES]);
  let speed = $state(30);
  let hidden = $state(false);
  let enabled = $state(true);
  let paused = $state(false);
  let refreshTimer = null;

  function normalizeType(t) {
    const lower = (t || 'info').toLowerCase();
    return ALLOWED_TYPES[lower] ? lower : 'info';
  }

  async function loadTicker() {
    if (hidden) return;

    let config = { enabled: true, speed: 30, sources: {} };
    let liveItems = [];

    try {
      const configRes = await api.get('/setup/api/ticker/config');
      if (configRes?.config) config = configRes.config;
    } catch { /* use defaults */ }

    if (!config.enabled) { enabled = false; return; }
    enabled = true;
    speed = config.speed || 30;

    try {
      const dataRes = await api.get('/setup/api/market/ticker');
      if (dataRes?.items) liveItems = dataRes.items;
    } catch { /* use defaults */ }

    if (config.sources?.manual?.enabled && config.sources.manual.items?.length) {
      for (const text of config.sources.manual.items) {
        liveItems.push({ type: 'info', text, source: 'manual' });
      }
    }

    items = liveItems.length > 0 ? liveItems : [...DEFAULT_HEADLINES];
  }

  function dismiss() {
    hidden = true;
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch { /* ignore */ }
  }

  /** Restore ticker (callable externally or via command palette) */
  export function show() {
    hidden = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    loadTicker();
  }

  onMount(() => {
    try { hidden = localStorage.getItem(STORAGE_KEY) === 'true'; } catch { /* ignore */ }
    setTimeout(loadTicker, 1500);
    refreshTimer = setInterval(loadTicker, REFRESH_MS);
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  // Duplicate items for seamless infinite scroll
  let doubledItems = $derived([...items, ...items]);
</script>

{#if !hidden && enabled}
  <div
    class="ticker-bar"
    role="marquee"
    aria-label="Live news ticker"
  >
    <div class="ticker-label">
      LIVE
      <span class="ticker-pulse"></span>
    </div>

    <div class="ticker-track">
      <div
        class="ticker-content"
        style="--ticker-speed: {speed}s"
        class:paused={paused}
        onmouseenter={() => paused = true}
        onmouseleave={() => paused = false}
      >
        {#each doubledItems as item, i}
          <span class="ticker-item">
            {#if i > 0}
              <span class="ticker-sep">&bull;</span>
            {/if}
            <span class="ticker-type {normalizeType(item.type)}">{item.type || 'info'}</span>
            {item.text || ''}
          </span>
        {/each}
      </div>
    </div>

    <button class="ticker-dismiss" onclick={dismiss} aria-label="Dismiss ticker">&times;</button>
  </div>
{/if}

<style>
  .ticker-bar {
    background: linear-gradient(90deg, var(--color-surface-2) 0%, var(--color-surface) 50%, var(--color-surface-2) 100%);
    border-bottom: 2px solid var(--color-accent);
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.15);
    overflow: hidden;
    height: 38px;
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .ticker-label {
    background: var(--color-accent);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 0 14px;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    z-index: 1;
    flex-shrink: 0;
  }

  .ticker-pulse {
    width: 8px;
    height: 8px;
    background: var(--color-success);
    border-radius: 50%;
    animation: tickerPulse 2s ease-in-out infinite;
  }

  @keyframes tickerPulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 4px var(--color-success); }
    50% { opacity: 0.4; box-shadow: none; }
  }

  .ticker-track {
    flex: 1;
    overflow: hidden;
    position: relative;
    height: 100%;
    margin-left: 12px;
    mask-image: linear-gradient(90deg, transparent 0%, black 2%, black 98%, transparent 100%);
    -webkit-mask-image: linear-gradient(90deg, transparent 0%, black 2%, black 98%, transparent 100%);
  }

  .ticker-content {
    display: flex;
    align-items: center;
    gap: 40px;
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    white-space: nowrap;
    will-change: transform;
    animation: tickerScroll var(--ticker-speed, 30s) linear infinite;
  }

  .ticker-content.paused {
    animation-play-state: paused;
  }

  @keyframes tickerScroll {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }

  .ticker-item {
    font-size: 13px;
    font-family: var(--font-mono);
    color: var(--color-text);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .ticker-sep {
    color: var(--color-text-2);
    opacity: 0.3;
    font-size: 10px;
  }

  .ticker-type {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 3px;
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .ticker-type.signal { background: var(--color-info); color: #fff; }
  .ticker-type.trade { background: var(--color-success); color: #fff; }
  .ticker-type.position { background: var(--color-warning); color: #000; }
  .ticker-type.info { background: var(--color-accent); color: #fff; }
  .ticker-type.headline { background: #e11d48; color: #fff; }
  .ticker-type.status { background: var(--color-text-2); color: var(--color-bg); }

  .ticker-dismiss {
    background: none;
    border: none;
    color: var(--color-text-2);
    cursor: pointer;
    font-size: 16px;
    padding: 0 10px;
    height: 100%;
    flex-shrink: 0;
    transition: color 150ms;
  }

  .ticker-dismiss:hover {
    color: var(--color-text);
  }
</style>
