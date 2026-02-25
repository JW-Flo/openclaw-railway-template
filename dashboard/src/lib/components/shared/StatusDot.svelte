<script>
  let { status = 'green', label = '', size = 'sm', pulse = false } = $props();

  const sizeMap = { sm: 'w-2 h-2', md: 'w-2.5 h-2.5', lg: 'w-3 h-3' };
  const colorMap = {
    green: 'bg-success',
    red: 'bg-danger',
    yellow: 'bg-warning',
    blue: 'bg-info',
    purple: 'bg-accent',
  };
</script>

<span class="inline-flex items-center gap-1.5">
  <span
    class="{sizeMap[size]} {colorMap[status]} rounded-full inline-block flex-shrink-0"
    class:animate-pulse={pulse}
  ></span>
  {#if label}
    <span class="text-sm text-text-2">{label}</span>
  {/if}
</span>

<style>
  .animate-pulse {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
</style>
