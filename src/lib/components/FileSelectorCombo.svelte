<script lang="ts">
  import {
    faChevronDown,
    faChevronUp,
    faCopy,
    faPlus,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons'
  import Fa from 'svelte-fa'
  import { renameFile, type FileInfo } from '../db.svelte'
  import { store } from '../store.svelte'

  interface FileSelectorComboProps {
    paneIndex: number
  }

  let { paneIndex }: FileSelectorComboProps = $props()

  let isOpen = $state(false)
  let searchQuery = $state('')
  let isEditingName = $state(false)
  let editingName = $state('')
  let pendingDelete = $state<FileInfo | null>(null)
  let rootEl = $state<HTMLDivElement | null>(null)
  let searchInputEl = $state<HTMLInputElement | null>(null)

  const currentFile = $derived(store.fileFor(paneIndex))
  const currentName = $derived(currentFile?.name ?? '')

  const filteredFiles = $derived.by(() => {
    const files = store.files ?? []
    const query = searchQuery.trim().toLowerCase()
    if (!query) return files
    return files.filter((file) => file.name.toLowerCase().includes(query))
  })

  // Mirror the active file's name into the input, unless the user is editing it.
  $effect(() => {
    if (!isEditingName) editingName = currentName
  })

  function open() {
    isOpen = true
    searchQuery = ''
    // Focus the filter box so typing narrows the list right away.
    queueMicrotask(() => searchInputEl?.focus())
  }

  function close() {
    isOpen = false
    searchQuery = ''
  }

  function selectFile(file: FileInfo) {
    store.selectFile(paneIndex, file)
    close()
  }

  async function handleCreate() {
    const file = await store.createAndOpen(paneIndex)
    if (file) close()
  }

  async function handleDuplicate() {
    const file = await store.duplicateAndOpen(paneIndex)
    if (file) close()
  }

  async function commitRename() {
    isEditingName = false
    const trimmed = editingName.trim()
    if (!trimmed || trimmed === currentName || !currentFile?.id) {
      editingName = currentName
      return
    }
    const renamed = await renameFile(currentFile.id, trimmed)
    // On rejection (e.g. duplicate name) put the old name back in the input.
    if (!renamed) editingName = currentName
  }

  function handleNameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      ;(event.target as HTMLInputElement).blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      editingName = currentName
      isEditingName = false
      ;(event.target as HTMLInputElement).blur()
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (isOpen && event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  /**
   * Arrow-key navigation for the option list. Bound to the whole dropdown, not
   * just the list, so it also works while the search box has focus — that is
   * where focus starts, and typing then arrowing down is the natural flow.
   */
  function handleListKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    const options = Array.from(
      rootEl?.querySelectorAll<HTMLButtonElement>('[data-file-option]') ?? [],
    )
    if (options.length === 0) return
    // With focus outside the list, ArrowDown starts at the first option and
    // ArrowUp at the last one.
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement)
    if (currentIndex === -1) {
      options[event.key === 'ArrowDown' ? 0 : options.length - 1]?.focus()
      return
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (currentIndex + delta + options.length) % options.length
    options[nextIndex]?.focus()
  }

  async function confirmDelete() {
    const target = pendingDelete
    pendingDelete = null
    if (target?.id !== undefined) await store.deleteFileById(target.id)
  }

  // Close the dropdown on any outside interaction.
  function handleWindowPointerDown(event: MouseEvent) {
    if (isOpen && rootEl && !rootEl.contains(event.target as Node)) close()
  }
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

{#if pendingDelete}
  <!--
    Rendered with fixed positioning so it is never clipped by the toolbar.
    Text colours are set explicitly: this markup sits inside the toolbar, which
    applies `text-white`, and inheriting that would make the text invisible
    against the dialog's white background.
  -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm file deletion"
      class="flex flex-col items-center gap-3 rounded-md border border-gray-400 bg-white p-4 text-gray-900 shadow-lg"
    >
      <p class="text-gray-900">
        Delete file "<span class="font-semibold">{pendingDelete.name}</span>"?
      </p>
      <div class="flex gap-2">
        <button
          onclick={confirmDelete}
          class="cursor-pointer rounded bg-(--jse-theme-color) px-4 py-1 text-white hover:bg-(--jse-theme-color-highlight)"
        >
          Delete
        </button>
        <button
          onclick={() => (pendingDelete = null)}
          class="cursor-pointer rounded border border-gray-400 px-4 py-1 text-gray-900 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

<div bind:this={rootEl} class="relative flex min-w-0 flex-1 items-stretch">
  <input
    type="text"
    bind:value={editingName}
    onfocus={() => {
      isEditingName = true
      editingName = currentName
    }}
    onblur={commitRename}
    onkeydown={handleNameKeydown}
    disabled={!currentFile}
    class="min-w-0 flex-1 truncate border-b border-transparent bg-transparent px-2 text-sm text-white outline-none placeholder-white/50 focus:border-white/60 disabled:opacity-50"
    placeholder="no file"
    title={currentName ? `${currentName} — click to rename` : 'Current file name — click to rename'}
    aria-label="Current file name"
  />
  <button
    onclick={() => (isOpen ? close() : open())}
    class="cursor-pointer border-l border-white/20 px-1.5 text-white hover:bg-(--jse-theme-color-highlight)"
    title="{isOpen ? 'Close' : 'Open'} file selector"
    aria-label="Toggle file selector"
    aria-expanded={isOpen}
    aria-haspopup="listbox"
  >
    <Fa icon={isOpen ? faChevronUp : faChevronDown} class="w-3" />
  </button>

  {#if isOpen}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute top-full left-0 z-40 w-full min-w-64 rounded-b border-t border-white/20 bg-(--jse-theme-color) shadow-lg"
      onkeydown={handleListKeydown}
    >
      <div class="flex items-center gap-1 border-b border-white/20 p-1">
        <input
          bind:this={searchInputEl}
          type="text"
          bind:value={searchQuery}
          placeholder="Search files…"
          aria-label="Search files"
          class="min-w-0 flex-1 rounded bg-white/10 px-2 py-0.5 text-sm text-white outline-none placeholder-white/50 focus:bg-white/20"
        />
        <button
          onclick={handleCreate}
          class="cursor-pointer rounded bg-(--jse-theme-color-highlight) px-1.5 py-0.5 text-white hover:bg-white/20"
          title="Create new file"
          aria-label="Create new file"
        >
          <Fa icon={faPlus} class="w-3" />
        </button>
        <button
          onclick={handleDuplicate}
          disabled={!currentFile}
          class="cursor-pointer rounded bg-(--jse-theme-color-highlight) px-1.5 py-0.5 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
          title="Duplicate current file"
          aria-label="Duplicate current file"
        >
          <Fa icon={faCopy} class="w-3" />
        </button>
      </div>

      <ul class="max-h-64 overflow-y-auto" role="listbox" aria-label="Files">
        {#each filteredFiles as file (file.id)}
          <li
            role="option"
            aria-selected={file.id === store.panes[paneIndex].fileId}
            class="group flex items-center {file.id === store.panes[paneIndex].fileId
              ? 'bg-white/20'
              : 'hover:bg-white/10'}"
          >
            <button
              data-file-option
              onclick={() => selectFile(file)}
              class="min-w-0 flex-1 cursor-pointer truncate px-3 py-1.5 text-left text-sm text-white"
              title={file.name}
            >
              {file.name}
            </button>
            <button
              onclick={() => (pendingDelete = file)}
              class="cursor-pointer px-2 py-1.5 text-white/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-300 focus:opacity-100"
              title="Delete file"
              aria-label="Delete {file.name}"
            >
              <Fa icon={faTrash} class="w-3" />
            </button>
          </li>
        {:else}
          <li class="px-3 py-2 text-sm text-white/50 italic">No files found</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
