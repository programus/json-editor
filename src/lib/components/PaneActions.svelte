<script lang="ts">
  import { store } from '../store.svelte'
  import { isSameContent } from '../utils.svelte'

  function toggleSync() {
    if (store.syncEnabled) {
      store.setSyncEnabled(false)
      return
    }

    const same = isSameContent(store.panes[0].content, store.panes[1].content)
    if (same === undefined) {
      store.setError('Cannot enable sync: one of the editors contains invalid JSON.')
      return
    }
    if (!same) {
      store.setError('Cannot enable sync while the two editors have different contents.')
      return
    }
    store.setSyncEnabled(true)
  }
</script>

<!-- Floats between the panes without reaching into the splitter's internals. -->
<div
  class="pointer-events-none absolute top-1/4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-px"
>
  <div
    class="pointer-events-auto flex flex-col-reverse gap-px bg-white [&>button]:cursor-pointer [&>button]:bg-(--jse-theme-color) [&>button]:px-1 [&>button]:font-mono [&>button]:text-white [&>button]:hover:bg-(--jse-theme-color-highlight)"
  >
    <button
      class={store.syncEnabled ? 'bg-(--jse-theme-color-highlight)! text-orange-300!' : ''}
      onclick={toggleSync}
      title="Toggle sync [currently {store.syncEnabled ? 'ON' : 'OFF'}]"
      aria-pressed={store.syncEnabled}
    >
      ↔
    </button>
    <button onclick={() => store.copyContent(1, 0)} title="Copy right to left">&lt;</button>
    <button onclick={() => store.copyContent(0, 1)} title="Copy left to right">&gt;</button>
  </div>
</div>
