<script>
  let {
    oncopy2right,
    oncopy2left,
    onsyncchanged,
    hidden,
    canSync = $bindable(false),
  } = $props()

  let syncEnabled = $state(false)
</script>

<div class="{hidden ? 'hidden' : ''} z-10 absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col-reverse items-center justify-center gap-px bg-white [&>button]:bg-(--jse-theme-color) [&>button]:hover:bg-(--jse-theme-color-highlight) [&>button]:disabled:bg-gray-400 [&>button]:font-mono [&>button]:text-white [&>button]:cursor-pointer">
  <button
    class="px-1 {syncEnabled ? 'bg-(--jse-theme-color-highlight)! text-orange-300!' : ''}"
    onclick={() => {
      syncEnabled = !syncEnabled
      onsyncchanged(syncEnabled)
    }}
    disabled={!canSync}
    title="Toggle sync {canSync ? `(Only sync while no error) [Current ${syncEnabled ? 'ON' : 'OFF'}]` : '(Cannot sync while contents are different)'}"
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