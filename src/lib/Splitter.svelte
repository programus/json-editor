<script>
  import PopupButtons from "./PopupButtons.svelte";

  let {
    oncopy2right,
    oncopy2left,
    onsyncchanged,
    canSync = $bindable(true),
  } = $props()

</script>

<div class="relative w-full h-full">
  <PopupButtons {oncopy2right} {oncopy2left} {onsyncchanged} bind:canSync hidden={false} />
</div>