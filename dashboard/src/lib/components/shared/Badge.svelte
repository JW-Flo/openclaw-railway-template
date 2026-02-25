<script>
  let { variant = 'default', children } = $props();

  const variants = {
    default: 'bg-surface-2 text-text-2 border-border',
    success: 'bg-success/10 text-success border-success/20',
    danger: 'bg-danger/10 text-danger border-danger/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    info: 'bg-info/10 text-info border-info/20',
    accent: 'bg-accent/10 text-accent-2 border-accent/20',
  };
</script>

<span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border {variants[variant]}">
  {@render children()}
</span>
