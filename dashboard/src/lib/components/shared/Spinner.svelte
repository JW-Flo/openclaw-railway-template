<script>
  let { size = 'md' } = $props();
  const sizeMap = { sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-8 h-8' };
</script>

<span class="{sizeMap[size]} border-2 border-border-2 border-t-accent-2 rounded-full inline-block" style="animation: spin 0.6s linear infinite;"></span>
