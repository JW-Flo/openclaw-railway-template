<script>
  import '../app.css';
  import Sidebar from '$lib/components/layout/Sidebar.svelte';
  import TopBar from '$lib/components/layout/TopBar.svelte';
  import Toast from '$lib/components/shared/Toast.svelte';
  import { startHealthPolling, stopHealthPolling } from '$lib/stores/health.js';
  import { user, authLoading, checkAuth } from '$lib/stores/auth.js';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  let { children } = $props();
  let sidebarOpen = $state(false);

  // Derived: is this the login page?
  let isLoginPage = $derived($page.url.pathname.includes('/login'));

  onMount(() => {
    checkAuth();
    startHealthPolling();
    return stopHealthPolling;
  });
</script>

{#if isLoginPage}
  <!-- Login page renders without chrome -->
  {@render children()}
  <Toast />
{:else}
  <div class="flex h-screen overflow-hidden bg-bg">
    <Sidebar bind:open={sidebarOpen} />
    <div class="flex-1 flex flex-col min-w-0 md:ml-64">
      <TopBar onToggleSidebar={() => sidebarOpen = !sidebarOpen} />
      <main class="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col">
        <div class="flex-1 min-h-0">
          {@render children()}
        </div>
      </main>
    </div>
  </div>
  <Toast />
{/if}
