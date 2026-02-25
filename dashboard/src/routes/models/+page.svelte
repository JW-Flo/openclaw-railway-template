<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { success, error } from '$lib/stores/notifications.js';
  import Card from '$lib/components/shared/Card.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Spinner from '$lib/components/shared/Spinner.svelte';
  import CodeOutput from '$lib/components/shared/CodeOutput.svelte';

  let currentModel = $state('');
  let modelInput = $state('');
  let availableModels = $state('');
  let loadingCurrent = $state(true);
  let loadingList = $state(true);
  let setting = $state(false);
  let setOutput = $state('');
  let showSetOutput = $state(false);

  async function loadCurrentModel() {
    loadingCurrent = true;
    try {
      const res = await api.get('/setup/api/models/current');
      currentModel = res.model || res.output || 'Unknown';
      // Clean up multiline text output
      if (currentModel.includes('\n')) {
        const match = currentModel.match(/model[:\s]+(.+)/i);
        currentModel = match ? match[1].trim() : currentModel.split('\n')[0].trim();
      }
    } catch (e) {
      error('Failed to load current model: ' + e.message);
      currentModel = 'Error loading';
    } finally {
      loadingCurrent = false;
    }
  }

  async function loadModelList() {
    loadingList = true;
    try {
      const res = await api.get('/setup/api/models/list');
      availableModels = res.output || JSON.stringify(res, null, 2);
    } catch (e) {
      availableModels = 'Failed to load models: ' + e.message;
    } finally {
      loadingList = false;
    }
  }

  async function setModel() {
    const value = modelInput.trim();
    if (!value) return;
    setting = true;
    setOutput = '';
    showSetOutput = false;
    try {
      const res = await api.post('/setup/api/models/set', { model: value });
      setOutput = res.output || JSON.stringify(res, null, 2);
      showSetOutput = true;
      success(`Model set to ${value}`);
      modelInput = '';
      await loadCurrentModel();
    } catch (e) {
      setOutput = 'Failed to set model: ' + e.message;
      showSetOutput = true;
      error('Failed to set model: ' + e.message);
    } finally {
      setting = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') setModel();
  }

  onMount(() => {
    loadCurrentModel();
    loadModelList();
  });
</script>

<div>
  <h1 class="text-2xl font-bold text-text mb-6">Models</h1>

  <!-- Current Model -->
  <Card title="Current Model">
    {#if loadingCurrent}
      <div class="flex items-center py-2">
        <Spinner size="sm" />
      </div>
    {:else}
      <span class="text-2xl font-mono text-accent-2 font-bold">{currentModel}</span>
    {/if}
  </Card>

  <!-- Set Model -->
  <div class="mt-6">
    <label class="text-sm text-text-2 mb-2 block font-medium">Set Model</label>
    <div class="flex items-center gap-3">
      <input
        type="text"
        bind:value={modelInput}
        onkeydown={handleKeydown}
        placeholder="e.g. openrouter/auto or xai/grok-4"
        class="bg-bg border border-border rounded-lg px-4 py-2.5 font-mono text-sm text-text w-full focus:border-accent focus:outline-none transition-colors"
      />
      <Button variant="primary" loading={setting} onclick={setModel}>
        Set
      </Button>
    </div>
  </div>

  <!-- Set Model Output -->
  <div class="mt-4">
    <CodeOutput content={setOutput} visible={showSetOutput} title="Set Model Output" />
  </div>

  <!-- Available Models -->
  <div class="mt-6">
    <Card title="Available Models">
      {#if loadingList}
        <div class="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      {:else}
        <div class="font-mono text-xs text-text-2 whitespace-pre-wrap max-h-[400px] overflow-y-auto">
          {availableModels || 'No models available.'}
        </div>
      {/if}
    </Card>
  </div>
</div>
