<script lang="ts">
  import { mount, unmount } from 'svelte'
  import { JSONEditor, Mode, toJSONContent, type Content } from 'svelte-jsoneditor'
  import { parse, stringify } from 'lossless-json'
  import { Splitpanes, Pane } from 'svelte-splitpanes'
  import Splitter from './lib/Splitter.svelte'

  function isSameContent(a: Content, b: Content): boolean {
    try {
      return JSON.stringify(toJSONContent(a).json) === JSON.stringify(toJSONContent(b).json)
    } catch {
      return false
    }
  }

  const LosslessJSONParser = { parse, stringify }

  let content: Content = {
    text: undefined, // can be used to pass a stringified JSON document instead
    json: {
      array: [1, 2, 3],
      boolean: true,
      color: '#82b92c',
      null: null,
      number: 123,
      object: { a: 'b', c: 'd' },
      string: 'Hello World'
    }
  }

  let leftContent = $state(content)
  let rightContent = $state(content)
  let syncContents = $state(false)
  let canSync = $derived(isSameContent(leftContent, rightContent))

  $effect(() => {
    const splitterElement = document.querySelector('.splitpanes__splitter')
    if (splitterElement) {
      const splitter = mount(Splitter, {
        target: splitterElement,
        props: {
          oncopy2right: () => {
            rightContent = leftContent
          },
          oncopy2left: () => {
            leftContent = rightContent
          },
          onsyncchanged: (enabled: boolean) => {
            syncContents = enabled
          },
          canSync,
        }
      })

      return () => unmount(splitter)
    }
  })
</script>

<div class="h-full w-full relative">
  <Splitpanes>
    <Pane>
      <div class="h-full w-full">
        <JSONEditor parser={LosslessJSONParser} bind:content={leftContent} mode={Mode.text} onChange={(content, _, status) => {
          if (syncContents && !status.contentErrors) {
            rightContent = content
          }
        }} />
      </div>
    </Pane>
    <Pane>
      <div class="h-full w-full">
        <JSONEditor parser={LosslessJSONParser} bind:content={rightContent} mode={Mode.tree} onChange={(content) => {
          if (syncContents) {
            leftContent = content
          }
        }} />
      </div>
    </Pane>
  </Splitpanes>
</div>

<style>
</style>