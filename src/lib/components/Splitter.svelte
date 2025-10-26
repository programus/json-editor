<script lang="ts">
  import PopupButtons from "./PopupButtons.svelte";

  interface SplitterProps {
    oncopy2right: () => void
    oncopy2left: () => void
    onsyncchanged: (enabled: boolean) => void
    syncEnabled?: boolean
    canSyncCheck: () => boolean
    saveToBrowserDB: boolean
    toggleSaveToBrowserDB?: () => void
  }

  let {
    oncopy2right,
    oncopy2left,
    onsyncchanged,
    syncEnabled,
    canSyncCheck,
    saveToBrowserDB,
    toggleSaveToBrowserDB,
  }: SplitterProps = $props()

</script>

<div class="relative w-full h-full">
  <PopupButtons {oncopy2right} {oncopy2left} {onsyncchanged} {syncEnabled} {canSyncCheck} hidden={false} {saveToBrowserDB} {toggleSaveToBrowserDB} />
</div>