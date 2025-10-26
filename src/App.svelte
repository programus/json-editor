<script lang="ts">
  import { mount, unmount } from 'svelte'
  import { Mode, toJSONContent, type Content } from 'svelte-jsoneditor'
  import { Splitpanes, Pane } from 'svelte-splitpanes'
  import Splitter from './lib/components/Splitter.svelte'
  import JSONEditorEx from './lib/components/JSONEditorEx.svelte'
  import { defaultContent } from './lib/utils.svelte'
  import { save } from './lib/db.svelte';

  function isSameContent(a: Content, b: Content): boolean {
    try {
      return JSON.stringify(toJSONContent(a).json) === JSON.stringify(toJSONContent(b).json)
    } catch {
      return false
    }
  }

  let meta = $state([
    {
      title: 'left-json-editor',
      content: defaultContent,
      mode: Mode.text,
    },
    {
      title: 'right-json-editor',
      content: defaultContent,
      mode: Mode.tree,
    }
  ])

  let saveToBrowserDB = $state(true)
  let syncContents = $state(false)

  $effect(() => {
    const splitterElement = document.querySelector('.splitpanes__splitter')
    if (splitterElement) {
      const splitter = mount(Splitter, {
        target: splitterElement,
        props: {
          oncopy2right: () => {
            meta[1].content = meta[0].content
            save(meta[1])
          },
          oncopy2left: () => {
            meta[0].content = meta[1].content
            save(meta[0])
          },
          onsyncchanged: (enabled: boolean) => {
            syncContents = enabled
            localStorage.setItem('sync-contents', String(enabled))
          },
          syncEnabled: syncContents,
          canSyncCheck: () => {
            return isSameContent(meta[0].content, meta[1].content)
          },
          saveToBrowserDB,
          toggleSaveToBrowserDB: () => {
            saveToBrowserDB = !saveToBrowserDB
            localStorage.setItem('save-to-browser-db', String(saveToBrowserDB))
          }
        }
      })

      return () => unmount(splitter)
    }
  })

  $effect(() => {
    const savedSetting = localStorage.getItem('save-to-browser-db')
    if (savedSetting !== 'false') {
      saveToBrowserDB = true
    } else {
      saveToBrowserDB = false
    }
  })

  $effect(() => {
    const syncSetting = localStorage.getItem('sync-contents')
    if (syncSetting === 'true') {
      syncContents = true
    } else {
      syncContents = false
    }
  })
</script>

<div class="h-full w-full relative">
  <Splitpanes>
    {#each meta as m, i (i)}
      <Pane>
        <div class="h-full w-full">
          <JSONEditorEx bind:content={meta[i].content} bind:mode={meta[i].mode}
            syncFunc={(content) => {
              const otherIndex = i === 0 ? 1 : 0
              meta[otherIndex].content = content
              if (saveToBrowserDB) {
                // Save the other editor's content as well
                const otherMeta = meta[otherIndex]
                save(otherMeta)
              }
            }}
            editorTitle={meta[i].title}
            {syncContents}
            {saveToBrowserDB}
          />
        </div>
      </Pane>
    {/each}
  </Splitpanes>
</div>

<style>
</style>