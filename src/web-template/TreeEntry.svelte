<script>
  import { formatPreviewTreeEntryName } from '../rendering/tree-labels';

  export let entry;
  export let selectedPath = null;
  export let onSelect;

  let expanded = true;
  $: displayName = formatPreviewTreeEntryName(entry);
  $: statusToneClass = entry.gitStatus ? `git-${entry.gitStatus.tone}` : '';
  $: isDisabledFile = entry.type === 'file' && entry.disabled;

  function handleClick() {
    if (entry.type === 'directory') {
      expanded = !expanded;
      return;
    }
    if (isDisabledFile) {
      return;
    }
    onSelect(entry.path);
  }
</script>

<li class="tree-entry">
  <button
    type="button"
    class:tree-file={entry.type === 'file'}
    class:tree-directory={entry.type === 'directory'}
    class:selected={entry.type === 'file' && entry.path === selectedPath}
    class:tree-disabled={isDisabledFile}
    class={statusToneClass}
    disabled={isDisabledFile}
    on:click={handleClick}
  >
    <span class="tree-icon" aria-hidden="true">
      {#if entry.type === 'directory'}
        <svg class="tree-svg tree-chevron" class:expanded viewBox="0 0 16 16">
          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {:else}
        <svg class="tree-svg" viewBox="0 0 16 16">
          <path d="M4.25 2.5h4.5l3 3v8a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
          <path d="M8.75 2.7v2.8h2.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {/if}
    </span>
    <span class="tree-name">{displayName}</span>
    {#if entry.gitStatus}
      <span class="tree-status" aria-label={`Git status ${entry.gitStatus.code}`}>{entry.gitStatus.code}</span>
    {/if}
  </button>
  {#if entry.type === 'directory' && expanded}
    <ul class="tree-children">
      {#each entry.children || [] as child (child.path)}
        <svelte:self entry={child} {selectedPath} {onSelect} />
      {/each}
    </ul>
  {/if}
</li>
