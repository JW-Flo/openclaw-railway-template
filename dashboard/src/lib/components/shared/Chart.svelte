<script>
  let {
    data = [],
    height = '200px',
  } = $props();

  let maxValue = $derived(Math.max(...data.map(d => d.value), 1));
  let hoveredIndex = $state(-1);
</script>

<div class="relative">
  <div class="flex items-end gap-1" style="height: {height};">
    {#each data as item, i}
      <div class="flex-1 flex flex-col justify-end h-full relative">
        <!-- Tooltip -->
        {#if hoveredIndex === i}
          <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-surface-3 border border-border-2 text-text text-xs px-2 py-1 rounded-lg shadow-lg whitespace-nowrap z-10 pointer-events-none">
            {item.value}
          </div>
        {/if}
        <!-- Bar -->
        <div
          class="w-full rounded-t-sm transition-all duration-300 cursor-pointer"
          style="height: {(item.value / maxValue) * 100}%; background-color: {item.color || 'var(--color-accent)'}; opacity: {hoveredIndex === -1 || hoveredIndex === i ? 1 : 0.5}; min-height: 2px;"
          role="img"
          aria-label="{item.label}: {item.value}"
          onmouseenter={() => hoveredIndex = i}
          onmouseleave={() => hoveredIndex = -1}
        ></div>
      </div>
    {/each}
  </div>
  <!-- Labels -->
  <div class="flex gap-1 mt-1">
    {#each data as item}
      <div class="flex-1 text-xs text-text-3 text-center truncate" title={item.label}>
        {item.label}
      </div>
    {/each}
  </div>
</div>
