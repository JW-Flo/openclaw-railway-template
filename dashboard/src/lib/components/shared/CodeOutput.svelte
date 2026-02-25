<script>
  let {
    content = '',
    visible = true,
    maxHeight = '300px',
    title = '',
  } = $props();
</script>

{#if visible}
  <div class="bg-bg border border-border rounded-xl overflow-hidden">
    {#if title}
      <div class="text-xs text-text-3 px-4 py-2 border-b border-border bg-surface/50 font-medium">
        {title}
      </div>
    {/if}
    <div
      class="px-4 py-3 font-mono text-xs whitespace-pre-wrap overflow-y-auto"
      style="max-height: {maxHeight};"
    >
      {#if content}
        <span class="text-success">{content}</span>
      {:else}
        <span class="text-text-3">No output</span>
      {/if}
    </div>
  </div>
{/if}
