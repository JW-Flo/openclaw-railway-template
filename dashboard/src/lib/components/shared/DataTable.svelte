<script>
  let {
    columns = [],
    rows = [],
    loading = false,
    emptyMessage = 'No data available',
    renderCell = undefined,
    children,
  } = $props();

  let maxValue = $derived(Math.max(...rows.map(r => Object.values(r).filter(v => typeof v === 'number')), 0));
</script>

<div class="bg-surface border border-border rounded-xl overflow-hidden">
  <div class="overflow-x-auto">
    <table class="w-full border-collapse">
      <thead>
        <tr>
          {#each columns as col}
            <th
              class="text-left px-4 py-3 text-xs font-medium text-text-3 uppercase tracking-wider border-b border-border bg-surface-2/50"
              style={col.width ? `width: ${col.width}` : ''}
            >
              {col.label}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if loading}
          {#each Array(5) as _, i}
            <tr>
              {#each columns as col}
                <td class="px-4 py-3 border-b border-border/50">
                  <div class="h-4 rounded bg-surface-2 skeleton-shimmer" style="width: {60 + (i * 7 + columns.indexOf(col) * 13) % 30}%"></div>
                </td>
              {/each}
            </tr>
          {/each}
        {:else if rows.length === 0}
          <tr>
            <td colspan={columns.length} class="px-4 py-12 text-center text-sm text-text-3">
              {emptyMessage}
            </td>
          </tr>
        {:else}
          {#each rows as row, rowIndex}
            <tr class="group">
              {#each columns as col}
                <td class="px-4 py-3 text-sm border-b border-border/50 transition-colors duration-150 group-hover:bg-surface-2/30">
                  {#if renderCell}
                    {@html renderCell(row, col)}
                  {:else}
                    {row[col.key] ?? ''}
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .skeleton-shimmer {
    background: linear-gradient(90deg, var(--color-surface-2) 25%, var(--color-surface-3) 50%, var(--color-surface-2) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }
</style>
