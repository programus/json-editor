<script lang="ts">
  import { faFloppyDisk, faFolderOpen } from '@fortawesome/free-solid-svg-icons'
  import {
    JSONEditor,
    type MenuItem,
    type OnRenderMenu,
    type TextContent,
  } from 'svelte-jsoneditor'
  import FileSelectorCombo from './FileSelectorCombo.svelte'
  import { store } from '../store.svelte'
  import { contentToText, LosslessJSONParser } from '../utils.svelte'

  interface EditorPaneProps {
    paneIndex: number
  }

  let { paneIndex }: EditorPaneProps = $props()

  const pane = $derived(store.panes[paneIndex])

  function loadFromDisk() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json,text/plain'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = () => {
        const text = String(reader.result ?? '')
        try {
          // Validate before touching the editor: invalid content would be
          // autosaved straight over the currently open file.
          LosslessJSONParser.parse(text)
        } catch {
          store.setError(`"${file.name}" does not contain valid JSON.`)
          return
        }
        const loaded: TextContent = { text }
        store.handleChange(paneIndex, loaded, false)
      }
      reader.onerror = () => store.setError(`Could not read "${file.name}".`)
      reader.readAsText(file)
    }
    input.click()
  }

  function saveToDisk() {
    let text: string
    try {
      text = contentToText(pane.content)
    } catch {
      store.setError('Cannot download while the content is invalid JSON.')
      return
    }

    const name = store.nameFor(paneIndex) || `json-editor-${paneIndex + 1}`
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name.endsWith('.json') ? name : `${name}.json`
    // Some browsers require the anchor to be connected, and revoking the URL
    // in the same tick can abort the download.
    document.body.append(anchor)
    anchor.click()
    setTimeout(() => {
      anchor.remove()
      URL.revokeObjectURL(url)
    }, 0)
  }

  const extraMenuItems: MenuItem[] = [
    {
      type: 'button',
      icon: faFolderOpen,
      title: 'Load file from local disk',
      onClick: loadFromDisk,
    },
    {
      type: 'button',
      icon: faFloppyDisk,
      title: 'Save file to local disk',
      onClick: saveToDisk,
    },
  ]

  const handleRenderMenu: OnRenderMenu = (items) => [...items, ...extraMenuItems]
</script>

<div class="flex h-full min-h-0 w-full flex-col">
  <!-- Our own toolbar, so the third-party editor's DOM is left untouched. -->
  <div
    class="flex h-8 shrink-0 items-stretch bg-(--jse-theme-color) text-white"
    role="toolbar"
    aria-label="File controls"
  >
    <FileSelectorCombo {paneIndex} />
  </div>

  <div class="min-h-0 flex-1">
    <JSONEditor
      parser={LosslessJSONParser}
      content={pane.content}
      mode={pane.mode}
      onRenderMenu={handleRenderMenu}
      onChange={(updatedContent, _previousContent, status) => {
        store.handleChange(paneIndex, updatedContent, Boolean(status.contentErrors))
      }}
      onChangeMode={(mode) => store.handleModeChange(paneIndex, mode)}
      onBlur={() => store.flush(paneIndex)}
    />
  </div>
</div>
