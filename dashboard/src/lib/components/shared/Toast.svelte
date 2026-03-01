<script>
  import { notifications, dismiss } from '$lib/stores/notifications.js';

  const typeClasses = {
    success: 'bg-success/10 border-success/20 text-success',
    error: 'bg-danger/10 border-danger/20 text-danger',
    info: 'bg-info/10 border-info/20 text-info',
  };

  const typeIcons = {
    success: 'M5 13l4 4L19 7',
    error: 'M6 18L18 6M6 6l12 12',
    info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  };
</script>

<div class="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none" aria-label="Notifications">
  {#each $notifications as toast (toast.id)}
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      class="flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg shadow-black/30 pointer-events-auto toast-enter {typeClasses[toast.type] || typeClasses.info}"
    >
      <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d={typeIcons[toast.type] || typeIcons.info} />
      </svg>
      <span class="text-sm flex-1">{toast.message}</span>
      <button
        class="text-current opacity-50 hover:opacity-100 transition-opacity cursor-pointer flex-shrink-0 p-0.5"
        onclick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-enter {
    animation: slideInRight 0.2s ease-out;
  }

  @keyframes slideInRight {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
</style>
