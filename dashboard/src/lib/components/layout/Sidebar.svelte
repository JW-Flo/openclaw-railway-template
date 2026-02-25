<script>
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { health } from '$lib/stores/health.js';

  let { open = $bindable(false) } = $props();

  const navItems = [
    { href: '/overview', label: 'Overview', icon: 'grid' },
    { href: '/projects', label: 'Projects', icon: 'folder' },
    { href: '/models', label: 'Models', icon: 'cpu' },
    { href: '/skills', label: 'Skills', icon: 'puzzle' },
    { href: '/tools', label: 'Tools', icon: 'wrench' },
    'separator',
    { href: '/cron', label: 'Cron Jobs', icon: 'clock' },
    { href: '/sessions', label: 'Sessions', icon: 'terminal' },
    { href: '/reports', label: 'Reports', icon: 'chart' },
    { href: '/runner', label: 'Runner', icon: 'play' },
  ];

  const externalLinks = [
    { href: '/setup', label: 'Setup Wizard' },
    { href: '/openclaw', label: 'Control UI' },
    { href: '/tui', label: 'Terminal' },
  ];

  function isActive(href) {
    const fullHref = base + href;
    const pathname = $page.url.pathname;
    if (href === '/overview') {
      return pathname === base || pathname === base + '/' || pathname === fullHref;
    }
    return pathname.startsWith(fullHref);
  }

  function handleOverlayClick() {
    open = false;
  }

  let gatewayStatus = $derived(
    $health?.gateway === 'running' ? 'green'
    : $health?.gateway === 'starting' ? 'yellow'
    : 'red'
  );

  let gatewayLabel = $derived(
    $health?.gateway === 'running' ? 'Gateway running'
    : $health?.gateway === 'starting' ? 'Gateway starting'
    : $health ? 'Gateway stopped' : 'Disconnected'
  );
</script>

<!-- Mobile overlay -->
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/50 z-30 md:hidden"
    onclick={handleOverlayClick}
  ></div>
{/if}

<!-- Sidebar -->
<aside
  class="fixed left-0 top-0 w-64 h-screen bg-surface border-r border-border flex flex-col z-40 transition-transform duration-200 ease-in-out
    {open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0"
>
  <!-- Logo -->
  <div class="px-5 py-5 border-b border-border">
    <a href="{base}/overview" class="text-lg font-bold text-text">
      J<span class="text-accent-2">Claw</span>
    </a>
  </div>

  <!-- Navigation -->
  <nav class="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
    {#each navItems as item}
      {#if item === 'separator'}
        <div class="border-t border-border my-2 mx-3"></div>
      {:else}
        <a
          href="{base}{item.href}"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150
            {isActive(item.href) ? 'bg-accent/10 text-accent-2 font-medium' : 'text-text-2 hover:text-text hover:bg-surface-2'}"
          onclick={() => { open = false; }}
        >
          <span class="w-5 h-5 flex-shrink-0">
            {#if item.icon === 'grid'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            {:else if item.icon === 'folder'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            {:else if item.icon === 'cpu'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5M4.5 15.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
              </svg>
            {:else if item.icon === 'puzzle'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.421 48.421 0 01-4.185-.194c-.577-.07-1.108.39-1.108.97v2.07c0 .58.531 1.04 1.108.97a48.4 48.4 0 014.185-.194.64.64 0 01.657.643v0c0 .355-.186.676-.401.959a1.647 1.647 0 00-.349 1.003c0 1.035 1.008 1.875 2.25 1.875 1.243 0 2.25-.84 2.25-1.875 0-.369-.128-.713-.349-1.003-.215-.283-.401-.604-.401-.959v0c0-.356.272-.643.657-.643a48.421 48.421 0 014.185.194c.577.07 1.108-.39 1.108-.97v-2.07c0-.58-.531-1.04-1.108-.97a48.4 48.4 0 01-4.185.194.64.64 0 01-.657-.643v0z" />
              </svg>
            {:else if item.icon === 'wrench'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17l-5.71 5.71a2.121 2.121 0 01-3-3l5.71-5.71M17.5 6.5l-1.5 1.5m0 0l-3 3m3-3l3-3m-3 3l-3 3m9 1.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
            {:else if item.icon === 'clock'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            {:else if item.icon === 'terminal'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
              </svg>
            {:else if item.icon === 'chart'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            {:else if item.icon === 'play'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
            {/if}
          </span>
          {item.label}
        </a>
      {/if}
    {/each}
  </nav>

  <!-- External links -->
  <div class="border-t border-border px-3 py-4 space-y-1">
    {#each externalLinks as link}
      <a
        href={link.href}
        class="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-text-3 hover:text-text-2 transition-all duration-150 hover:bg-surface-2"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
        {link.label}
      </a>
    {/each}
  </div>

  <!-- Gateway status -->
  <div class="px-5 py-3 border-t border-border flex items-center gap-2 text-xs text-text-3">
    <span
      class="w-2 h-2 rounded-full flex-shrink-0"
      class:bg-success={gatewayStatus === 'green'}
      class:bg-warning={gatewayStatus === 'yellow'}
      class:bg-danger={gatewayStatus === 'red'}
      class:animate-pulse={gatewayStatus === 'yellow'}
    ></span>
    {gatewayLabel}
  </div>
</aside>

<style>
  .animate-pulse {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
</style>
