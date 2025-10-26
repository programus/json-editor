<script lang="ts">
  import { mount, unmount } from 'svelte'
  import { faFloppyDisk, faFolderOpen } from '@fortawesome/free-solid-svg-icons'
  import { JSONEditor, Mode, toJSONContent, isJSONContent, type Content, type TextContent, type MenuButton } from 'svelte-jsoneditor'
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
          canSyncCheck: () => {
            return isSameContent(leftContent, rightContent)
          },
        }
      })

      return () => unmount(splitter)
    }
  })

  function loadContentFromFile(callback: (content: TextContent) => void) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = (event: Event) => {
      const target = event.target as HTMLInputElement
      if (target.files && target.files.length > 0) {
        const file = target.files[0]
        const reader = new FileReader()
        reader.onload = (e: ProgressEvent<FileReader>) => {
          const text = e.target?.result as string
          callback({ text })
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }

  function saveContentToFile(content: Content, filename: string) {
    const jsonString = isJSONContent(content)
      ? LosslessJSONParser.stringify(toJSONContent(content).json, null, 2) || ''
      : content.text || ''
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function getTimestampString() {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')
    return `${year}${month}${day}${hours}${minutes}${seconds}`
  }

  function customMenu({ getter, setter }: { getter: () => Content; setter: (content: Content) => void }): MenuButton[] {
    return [
      {
        type: 'button',
        icon: faFolderOpen,
        title: 'Load file from local disk',
        onClick: () => {
          loadContentFromFile((loadedContent) => {
            setter(loadedContent)
          })
        },
      },
      {
        type: 'button',
        icon: faFloppyDisk,
        title: 'Save file to local disk',
        onClick: () => {
          const fileName = `jsoneditor_${getTimestampString()}.json`
          saveContentToFile(getter(), fileName)
        },
      },
    ]
  }
</script>

<div class="h-full w-full relative">
  <Splitpanes>
    <Pane>
      <div class="h-full w-full">
        <JSONEditor parser={LosslessJSONParser} bind:content={leftContent} mode={Mode.text}
          onChange={(content, _, status) => {
            if (syncContents && !status.contentErrors) {
              rightContent = content
            }
          }}
          onRenderMenu={(items, context) => {
            return [
              ...items,
              ...customMenu({ getter: () => leftContent, setter: (content) => leftContent = content }),
            ]
          }}
        />
      </div>
    </Pane>
    <Pane>
      <div class="h-full w-full">
        <JSONEditor parser={LosslessJSONParser} bind:content={rightContent} mode={Mode.tree}
          onChange={(content) => {
            if (syncContents) {
              leftContent = content
            }
          }}
          onRenderMenu={(items, context) => {
            return [
              ...items,
              ...customMenu({ getter: () => rightContent, setter: (content) => rightContent = content }),
            ]
          }}
        />
      </div>
    </Pane>
  </Splitpanes>
</div>

<style>
</style>