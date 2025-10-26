<script>
  import PopupButtons from "./PopupButtons.svelte";

  let {
    oncopy2right,
    oncopy2left,
    onsyncchanged,
    canSyncCheck,
  } = $props()

</script>

<div class="relative w-full h-full">
  <PopupButtons {oncopy2right} {oncopy2left} {onsyncchanged} {canSyncCheck} hidden={false} />
</div>