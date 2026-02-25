<script>
  import { login } from '$lib/stores/auth.js';
  import { error as notifyError } from '$lib/stores/notifications.js';
  import Button from '$lib/components/shared/Button.svelte';

  let username = $state('');
  let password = $state('');
  let loading = $state(false);
  let errorMsg = $state('');

  async function handleLogin() {
    if (!username.trim() || !password) return;
    loading = true;
    errorMsg = '';
    try {
      await login(username.trim(), password);
      window.location.href = '/dashboard/';
    } catch (err) {
      errorMsg = err.body || err.message || 'Invalid credentials';
      notifyError(errorMsg);
    }
    loading = false;
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') handleLogin();
  }
</script>

<div class="min-h-screen bg-bg flex items-center justify-center p-4">
  <div class="w-full max-w-sm">
    <!-- Logo -->
    <div class="text-center mb-8">
      <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
        <svg class="w-8 h-8 text-accent-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </div>
      <h1 class="text-2xl font-bold text-text">
        J<span class="text-accent-2">Claw</span>
      </h1>
      <p class="text-sm text-text-3 mt-1">Sign in to your dashboard</p>
    </div>

    <!-- Login form -->
    <div class="bg-surface border border-border rounded-2xl p-6 shadow-lg">
      <div class="space-y-4">
        <div>
          <label class="text-xs text-text-3 block mb-1.5">Username</label>
          <input
            bind:value={username}
            onkeydown={handleKeydown}
            placeholder="username"
            autocomplete="username"
            class="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-text placeholder-text-3
              focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-all"
          />
        </div>
        <div>
          <label class="text-xs text-text-3 block mb-1.5">Password</label>
          <input
            bind:value={password}
            onkeydown={handleKeydown}
            type="password"
            placeholder="password"
            autocomplete="current-password"
            class="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-text placeholder-text-3
              focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-all"
          />
        </div>

        {#if errorMsg}
          <div class="bg-danger/10 border border-danger/20 rounded-xl px-4 py-2.5 text-xs text-danger">
            {errorMsg}
          </div>
        {/if}

        <Button variant="primary" loading={loading} onclick={handleLogin} class="w-full">
          Sign In
        </Button>
      </div>
    </div>

    <p class="text-center text-[10px] text-text-3/50 mt-6">
      Default: owner / your SETUP_PASSWORD
    </p>
  </div>
</div>
