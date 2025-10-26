<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { faFloppyDisk, faFolderOpen } from '@fortawesome/free-solid-svg-icons'
  import { JSONEditor, Mode, toJSONContent, isJSONContent, type Content, type TextContent, type MenuButton } from 'svelte-jsoneditor'
  import { liveQuery } from 'dexie'
  import { parse, stringify } from 'lossless-json'
  import { defaultContent } from '../utils.svelte'
  import { db, save } from '../db.svelte';

  interface JSONEditorExProps extends ComponentProps<JSONEditor> {
    syncFunc?: ComponentProps<JSONEditor>['onChange']
    syncContents?: boolean
    editorTitle?: string
    saveToBrowserDB?: boolean
  }

  let {
    content = $bindable(defaultContent),
    syncContents = false,
    editorTitle = 'json-editor',
    saveToBrowserDB = $bindable(false),
    mode = $bindable(Mode.tree),
    syncFunc,
    ...otherProps
  }: JSONEditorExProps = $props()

  const LosslessJSONParser = { parse, stringify }

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

  let jsonEditor: JSONEditor

  let additionalMenuItems: MenuButton[] = [
      {
        type: 'button',
        icon: faFolderOpen,
        title: 'Load file from local disk',
        onClick: () => {
          loadContentFromFile((loadedContent) => {
            content = loadedContent
          })
        },
      },
      {
        type: 'button',
        icon: faFloppyDisk,
        title: 'Save file to local disk',
        onClick: () => {
          const fileName = `${editorTitle}_${getTimestampString()}.json`
          saveContentToFile(content, fileName)
        },
      },
    ]

  let handleRenderMenu: ComponentProps<JSONEditor>['onRenderMenu'] = (items, context) => {
    return [
      ...items,
      ...additionalMenuItems,
    ]
  }

  let savedContent = liveQuery(async () => {
    return await db.editors.get(editorTitle)
  })

  $effect(() => {
    content = $savedContent ? {
      text: $savedContent.text,
      } : defaultContent
  })
</script>


<JSONEditor bind:this={jsonEditor} parser={LosslessJSONParser} bind:content bind:mode {...otherProps}
  onRenderMenu={handleRenderMenu}
  onChange={(content, previousContent, status) => {
    otherProps.onChange?.(content, previousContent, status)
    if (saveToBrowserDB) {
      save({
        title: editorTitle,
        content,
        mode,
      })
    }
    if (syncContents && !status.contentErrors) {
      syncFunc?.(content, previousContent, status)
    }
  }}
/>