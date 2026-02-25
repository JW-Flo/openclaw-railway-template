<script>
  import '../app.css';
  import Sidebar from '$lib/components/layout/Sidebar.svelte';
  import TopBar from '$lib/components/layout/TopBar.svelte';
  import Toast from '$lib/components/shared/Toast.svelte';
  import { startHealthPolling, stopHealthPolling } from '$lib/stores/health.js';
  import { onMount } from 'svelte';

  let { children } = $props();
  let sidebarOpen = $state(false);

  onMount(() => {
    startHealthPolling();
    return stopHealthPolling;
  });
</script>

<div class="flex h-screen overflow-hidden bg-bg">
  <Sidebar bind:open={sidebarOpen} />
  <div class="flex-1 flex flex-col min-w-0 md:ml-64">
    <TopBar onToggleSidebar={() => sidebarOpen = !sidebarOpen} />
    <main class="flex-1 overflow-y-auto p-6">
      {@render children()}
    </main>
  </div>
</div>
<Toast />
