<script>
  let { title = '', class: className = '', children } = $props();
</script>

<div class="bg-surface border border-border rounded-2xl p-5 transition-all duration-200 ease-out hover:border-border-2 {className}">
  {#if title}
    <h3 class="text-xs font-medium text-text-3 uppercase tracking-wider mb-3">{title}</h3>
  {/if}
  {@render children()}
</div>
