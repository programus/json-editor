<script lang="ts">
  import { Pane, Splitpanes } from 'svelte-splitpanes'
  import EditorPane from './lib/components/EditorPane.svelte'
  import PaneActions from './lib/components/PaneActions.svelte'
  import { setDbErrorHandler } from './lib/db.svelte'
  import { store } from './lib/store.svelte'

  $effect(() => {
    setDbErrorHandler((message) => store.setError(message))
    return store.subscribeToFiles()
  })

  // Make sure a pending autosave is not lost when the tab goes away.
  $effect(() => {
    const flushAll = () => store.flush()
    window.addEventListener('pagehide', flushAll)
    document.addEventListener('visibilitychange', flushAll)
    return () => {
      window.removeEventListener('pagehide', flushAll)
      document.removeEventListener('visibilitychange', flushAll)
      flushAll()
    }
  })

  // Auto-dismiss error messages so they do not linger forever.
  $effect(() => {
    if (!store.errorMessage) return
    const timer = setTimeout(() => store.setError(null), 6000)
    return () => clearTimeout(timer)
  })
</script>

<div class="relative h-full w-full">
  <Splitpanes>
    <Pane>
      <EditorPane paneIndex={0} />
    </Pane>
    <Pane>
      <EditorPane paneIndex={1} />
    </Pane>
  </Splitpanes>

  <PaneActions />

  {#if store.errorMessage}
    <div class="pointer-events-none absolute inset-x-0 bottom-4 z-50 flex justify-center">
      <div
        role="alert"
        class="pointer-events-auto flex items-center gap-3 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 shadow-lg"
      >
        <span>{store.errorMessage}</span>
        <button
          onclick={() => store.setError(null)}
          class="cursor-pointer text-red-500 hover:text-red-800"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  {/if}
</div>
