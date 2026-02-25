<script>
  import { tick } from 'svelte';

  let {
    open = $bindable(false),
    title = '',
    size = 'md',
    children,
    footer,
  } = $props();

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  };

  let dialogEl = $state(null);
  let previousFocus = $state(null);

  const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  $effect(() => {
    if (open) {
      previousFocus = document.activeElement;
      tick().then(() => {
        if (dialogEl) {
          const focusable = dialogEl.querySelectorAll(FOCUSABLE);
          if (focusable.length) focusable[0].focus();
        }
      });
    } else if (previousFocus) {
      previousFocus.focus();
      previousFocus = null;
    }
  });

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) {
      open = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      open = false;
      return;
    }
    if (e.key === 'Tab' && dialogEl) {
      const focusable = [...dialogEl.querySelectorAll(FOCUSABLE)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 modal-overlay"
    onclick={handleOverlayClick}
  >
    <div bind:this={dialogEl} class="bg-surface border border-border rounded-3xl shadow-2xl shadow-black/50 w-full {sizeClasses[size]} modal-content">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 class="text-lg font-semibold text-text">{title}</h2>
        <button
          class="text-text-3 hover:text-text transition-colors duration-150 cursor-pointer p-1 rounded-lg hover:bg-surface-2"
          onclick={() => open = false}
          aria-label="Close modal"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="px-6 py-4">
        {@render children()}
      </div>

      <!-- Footer -->
      {#if footer}
        <div class="px-6 py-4 border-t border-border flex justify-end gap-3">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    animation: fadeInOverlay 0.15s ease;
  }

  .modal-content {
    animation: fadeInContent 0.15s ease;
  }

  @keyframes fadeInOverlay {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes fadeInContent {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
