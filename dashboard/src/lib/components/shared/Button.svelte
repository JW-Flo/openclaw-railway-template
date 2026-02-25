<script>
  import Spinner from './Spinner.svelte';

  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    onclick = undefined,
    class: className = '',
    children,
  } = $props();

  const variantClasses = {
    primary: 'bg-accent hover:bg-accent-2 text-white',
    secondary: 'bg-surface-2 border border-border hover:border-accent text-text',
    danger: 'bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20',
    ghost: 'bg-transparent text-text-2 hover:text-text hover:bg-surface-2',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  };

  let isDisabled = $derived(disabled || loading);
</script>

<button
  class="inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 cursor-pointer {variantClasses[variant]} {sizeClasses[size]} {isDisabled ? 'opacity-50 cursor-not-allowed' : ''} {className}"
  disabled={isDisabled}
  onclick={onclick}
>
  {#if loading}
    <Spinner size="sm" />
  {/if}
  {@render children()}
</button>
