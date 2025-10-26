<script lang="ts">
  let {
    oncopy2right,
    oncopy2left,
    onsyncchanged,
    hidden,
    canSyncCheck,
  } = $props()

  let syncEnabled = $state(false)
  let alertDialog: HTMLDialogElement | null = null
</script>

<dialog bind:this={alertDialog} class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-4 rounded-md border border-gray-400 bg-white shadow-md">
  <div class="w-full h-full flex flex-col justify-center items-center">
    <p>Cannot enable sync when contents are different.</p>
    <button onclick={() => alertDialog?.close()} class="px-4 bg-(--jse-theme-color) hover:bg-(--jse-theme-color-highlight) text-white">OK</button>
  </div>
</dialog>
<div class="{hidden ? 'hidden' : ''} z-10 absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col-reverse items-center justify-center gap-px bg-white [&>button]:bg-(--jse-theme-color) [&>button]:hover:bg-(--jse-theme-color-highlight) [&>button]:disabled:bg-gray-400 [&>button]:font-mono [&>button]:text-white [&>button]:cursor-pointer">
  <button
    class="px-1 {syncEnabled ? 'bg-(--jse-theme-color-highlight)! text-orange-300!' : ''}"
    onclick={() => {
      if (canSyncCheck()) {
        syncEnabled = !syncEnabled
        onsyncchanged(syncEnabled)
      } else {
        alertDialog?.showModal()
      }
    }}
    title="Toggle sync [Current {syncEnabled ? 'ON' : 'OFF'}]"
  >
    ↔
  </button>
  <button
    class="px-1"
    onclick={oncopy2left}
    title="Copy right to left"
  >
    &lt;
  </button>
  <button
    class="px-1"
    onclick={oncopy2right}
    title="Copy left to right"
  >
    &gt;
  </button>
</div>