import { liveQuery } from 'dexie'
import { Mode, type Content } from 'svelte-jsoneditor'
import { createFile, db, deleteFile, listFiles, saveFile, type FileInfo } from './db.svelte'
import { cloneContent, contentToText, createDefaultContent, debounce } from './utils.svelte'

const SYNC_STORAGE_KEY = 'sync-contents'
const paneStorageKey = (index: number) => `current-file-id-pane-${index}`

/** Per-pane editor state. Content lives here; the DB is the persistence layer. */
export interface PaneState {
  content: Content
  mode: Mode
  fileId: number | null
  /**
   * `updatedAt` of the revision this pane is based on, used to detect a write
   * from another tab. `null` while no file is open.
   */
  baseUpdatedAt: number | null
}

/** A save that was refused because another tab changed the file first. */
export interface SyncConflict {
  paneIndex: number
  fileId: number
  fileName: string
  /** The content this pane tried to save, replayed if the user overwrites. */
  ours: Content
  mode: Mode
  theirs: FileInfo
}

const AUTOSAVE_DELAY_MS = 400
const PANE_COUNT = 2

class EditorStore {
  /** Live view of all files, ordered by creation. `undefined` until loaded. */
  files = $state<FileInfo[] | undefined>(undefined)

  // Default modes differ so the two panes are useful straight away: raw text on
  // the left, structured tree on the right. A file's saved mode overrides this.
  panes = $state<PaneState[]>([
    { content: createDefaultContent(), mode: Mode.text, fileId: null, baseUpdatedAt: null },
    { content: createDefaultContent(), mode: Mode.tree, fileId: null, baseUpdatedAt: null },
  ])

  syncEnabled = $state(false)

  /** Transient message shown to the user when a storage operation fails. */
  errorMessage = $state<string | null>(null)

  /** Set while a cross-tab conflict is waiting for the user to decide. */
  conflict = $state<SyncConflict | null>(null)

  /**
   * True while both panes show the same file. Sync is then forced on and
   * cannot be turned off: the two panes are literally one document, so letting
   * them diverge would make each pane overwrite the other's autosave.
   */
  get syncLocked(): boolean {
    const [first, second] = this.panes
    return first.fileId !== null && first.fileId === second.fileId
  }

  /**
   * Set while a sync-driven write is in flight. `svelte-jsoneditor` does not
   * re-fire `onChange` for content set from outside, so today no loop occurs;
   * this makes that invariant explicit instead of relying on library internals.
   * Cleared on a microtask so it also covers asynchronous echo-backs.
   */
  #applyingSync = false

  /** One debounced writer per pane so panes never cancel each other's saves. */
  #savers = Array.from({ length: PANE_COUNT }, (_unused, paneIndex) =>
    debounce((fileId: number, content: Content, mode: Mode) => {
      void this.#save(paneIndex, fileId, content, mode)
    }, AUTOSAVE_DELAY_MS),
  )

  /**
   * Write one pane's content, guarding against a concurrent write from another
   * tab. On conflict nothing is stored and the user is asked what to do.
   */
  async #save(paneIndex: number, fileId: number, content: Content, mode: Mode, force = false) {
    const pane = this.panes[paneIndex]
    const base = force ? undefined : (pane.baseUpdatedAt ?? undefined)
    const result = await saveFile(fileId, content, mode, base)

    switch (result.status) {
      case 'saved':
        // Only advance the baseline if the pane still shows this file; it may
        // have moved on while the write was in flight.
        if (pane.fileId === fileId) pane.baseUpdatedAt = result.updatedAt
        // Both panes on one file share a row, so both baselines must advance.
        if (this.syncLocked) {
          for (const other of this.panes) {
            if (other.fileId === fileId) other.baseUpdatedAt = result.updatedAt
          }
        }
        break
      case 'conflict':
        this.conflict = {
          paneIndex,
          fileId,
          fileName: result.theirs.name,
          ours: cloneContent(content),
          mode,
          theirs: result.theirs,
        }
        break
      case 'missing':
        // The row is gone; resync so `#reconcile` moves the pane somewhere valid.
        this.#refreshFiles()
        break
      case 'failed':
        break
    }
  }

  /** Keep our edit and stamp it over the other tab's revision. */
  resolveConflictWithOurs() {
    const conflict = this.conflict
    if (!conflict) return
    this.conflict = null
    void this.#save(conflict.paneIndex, conflict.fileId, conflict.ours, conflict.mode, true)
  }

  /** Discard our edit and adopt whatever the other tab stored. */
  resolveConflictWithTheirs() {
    const conflict = this.conflict
    if (!conflict) return
    this.conflict = null

    this.panes.forEach((pane, index) => {
      if (pane.fileId !== conflict.fileId) return
      this.#savers[index].cancel()
      pane.content = { text: conflict.theirs.text }
      pane.baseUpdatedAt = conflict.theirs.updatedAt
    })
  }

  constructor() {
    this.syncEnabled = localStorage.getItem(SYNC_STORAGE_KEY) === 'true'
  }

  /**
   * Re-apply the "same file means synced" rule after any change of open file.
   *
   * Opening the same file in both panes turns sync on; moving either pane to a
   * different file turns it off again. Anyone who wants to sync two *different*
   * files can switch it back on by hand, or use the copy buttons.
   */
  #applySyncLock() {
    const locked = this.syncLocked
    if (locked === this.syncEnabled) return
    this.setSyncEnabled(locked)
  }

  /**
   * Subscribe to the file list. Returns a teardown function, and is driven
   * from a component `$effect` so the subscription follows the app lifecycle.
   */
  subscribeToFiles(): () => void {
    const query = liveQuery(() => listFiles())
    const subscription = query.subscribe({
      next: (files) => {
        this.files = files
        this.#reconcile(files)
      },
      error: (error) => {
        this.setError('Could not read files from browser storage.')
        console.error(error)
      },
    })
    return () => subscription.unsubscribe()
  }

  #refreshFiles() {
    void listFiles()
      .then((files) => {
        this.files = files
        this.#reconcile(files)
      })
      .catch((error) => console.error(error))
  }

  /**
   * Keep every pane pointing at a file that actually exists. Runs whenever the
   * file list changes, covering first load, deletion from either pane, and the
   * empty-database case.
   *
   * On first load each pane restores its own previously open file; with no
   * stored choice, pane 0 takes the first file and pane 1 the second (so a
   * fresh two-file database shows different files side by side).
   */
  #reconcile(files: FileInfo[]) {
    if (files.length === 0) {
      for (const pane of this.panes) {
        pane.fileId = null
        pane.baseUpdatedAt = null
      }
      this.#applySyncLock()
      void this.#createInitialFile()
      return
    }

    this.panes.forEach((pane, index) => {
      const open = pane.fileId === null ? undefined : files.find((file) => file.id === pane.fileId)
      if (open) {
        this.#adoptExternalRevision(index, open)
        return
      }

      if (pane.fileId !== null) {
        // The open file vanished; fall back to the nearest surviving file.
        this.#openFile(index, files[Math.min(index, files.length - 1)])
        return
      }

      const stored = localStorage.getItem(paneStorageKey(index))
      const storedId = stored ? Number.parseInt(stored, 10) : Number.NaN
      const restored = Number.isNaN(storedId)
        ? undefined
        : files.find((file) => file.id === storedId)
      this.#openFile(index, restored ?? files[Math.min(index, files.length - 1)])
    })

    // Applied once at the end: mid-loop the panes can be in a transient state
    // where both still point at the same file.
    this.#applySyncLock()
  }

  /**
   * Pick up a revision written by another tab.
   *
   * Only done when this pane has nothing queued and no unsaved edit, so a
   * pane the user is typing in is never yanked out from under them — that case
   * becomes a conflict prompt on the next save instead. Panes with an
   * in-flight save are also skipped; their baseline is set by `#save`.
   */
  #adoptExternalRevision(paneIndex: number, file: FileInfo) {
    const pane = this.panes[paneIndex]
    if (file.updatedAt === undefined || file.updatedAt === pane.baseUpdatedAt) return
    if (this.#savers[paneIndex].pending) return

    let text: string
    try {
      text = contentToText(pane.content)
    } catch {
      // Unserializable content counts as an unsaved edit: leave the baseline
      // alone so the difference surfaces as a conflict rather than being lost.
      return
    }
    if (text !== file.text) return

    pane.baseUpdatedAt = file.updatedAt
  }

  #creatingInitialFile = false

  async #createInitialFile() {
    if (this.#creatingInitialFile) return
    this.#creatingInitialFile = true
    try {
      const existing = await db.files.count()
      if (existing === 0) {
        await createFile(this.#nextFileName())
      }
    } finally {
      this.#creatingInitialFile = false
    }
  }

  #nextFileName(): string {
    const stamp = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    return `file-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`
  }

  /**
   * Load a file's persisted text into a pane without touching the DB.
   *
   * Callers that change one pane in isolation must apply the sync lock
   * afterwards; `#reconcile` does it once after updating both panes.
   */
  #openFile(paneIndex: number, file: FileInfo) {
    const pane = this.panes[paneIndex]
    this.#savers[paneIndex].cancel()
    pane.fileId = file.id ?? null
    pane.content = { text: file.text }
    pane.baseUpdatedAt = file.updatedAt ?? null
    if (file.mode) pane.mode = file.mode
    if (file.id !== undefined) {
      localStorage.setItem(paneStorageKey(paneIndex), String(file.id))
    }
  }

  fileFor(paneIndex: number): FileInfo | undefined {
    const fileId = this.panes[paneIndex].fileId
    if (fileId === null) return undefined
    return this.files?.find((file) => file.id === fileId)
  }

  nameFor(paneIndex: number): string {
    return this.fileFor(paneIndex)?.name ?? ''
  }

  selectFile(paneIndex: number, file: FileInfo) {
    this.#openFile(paneIndex, file)
    // Update the lock first: moving off a shared file releases it, and landing
    // on the file the other pane has open engages it.
    this.#applySyncLock()
    if (this.syncEnabled) {
      // Sync means both panes show the same thing; mirror the newly opened file.
      this.#mirrorTo(paneIndex === 0 ? 1 : 0, this.panes[paneIndex].content)
    }
  }

  /** Called by a pane whenever its editor content changes. */
  handleChange(paneIndex: number, content: Content, hasErrors: boolean) {
    const pane = this.panes[paneIndex]
    pane.content = content

    if (pane.fileId !== null) {
      this.#savers[paneIndex].call(pane.fileId, content, pane.mode)
    }

    if (this.syncEnabled && !hasErrors && !this.#applyingSync) {
      this.#applyingSync = true
      try {
        this.#mirrorTo(paneIndex === 0 ? 1 : 0, content)
      } finally {
        // Release after the current task so an echoed change is ignored.
        void Promise.resolve().then(() => {
          this.#applyingSync = false
        })
      }
    }
  }

  handleModeChange(paneIndex: number, mode: Mode) {
    const pane = this.panes[paneIndex]
    pane.mode = mode
    // Persist the mode itself, but do not rewrite `text`: re-serializing here
    // would silently reformat whatever the user typed.
    if (pane.fileId !== null) {
      this.#savers[paneIndex].call(pane.fileId, pane.content, mode)
    }
  }

  /** Force any pending autosave for a pane to disk immediately. */
  flush(paneIndex?: number) {
    if (paneIndex === undefined) this.#savers.forEach((saver) => saver.flush())
    else this.#savers[paneIndex].flush()
  }

  /**
   * Write content into a pane, always as a fresh object: sharing one reference
   * between panes would make them alias each other's state.
   */
  #mirrorTo(paneIndex: number, content: Content) {
    const pane = this.panes[paneIndex]
    const copy = cloneContent(content)
    pane.content = copy
    // When both panes show the same file the source pane already queued this
    // write; queueing it again would just write the same row twice.
    if (pane.fileId !== null && !this.syncLocked) {
      this.#savers[paneIndex].call(pane.fileId, copy, pane.mode)
    }
  }

  /** Copy content from one pane to the other (the `<` / `>` buttons). */
  copyContent(fromIndex: number, toIndex: number) {
    this.#mirrorTo(toIndex, this.panes[fromIndex].content)
  }

  /**
   * Turn sync on or off. Refuses to switch it off while both panes show the
   * same file, where the two editors are one document and must stay in step.
   */
  setSyncEnabled(enabled: boolean) {
    if (!enabled && this.syncLocked) return
    this.syncEnabled = enabled
    localStorage.setItem(SYNC_STORAGE_KEY, String(enabled))
  }

  async createAndOpen(paneIndex: number): Promise<FileInfo | undefined> {
    const file = await createFile(this.#nextFileName(), '{}', this.panes[paneIndex].mode)
    if (file) {
      this.#openFile(paneIndex, file)
      // A brand new file is unique to this pane, so any lock is released.
      this.#applySyncLock()
    }
    return file
  }

  /**
   * Duplicate the file open in a pane and switch the pane to the copy.
   *
   * The copy takes the text currently in the editor rather than what is on
   * disk, so an edit that is still within the autosave debounce window is not
   * silently lost. The original is flushed first so it keeps that edit too.
   */
  async duplicateAndOpen(paneIndex: number): Promise<FileInfo | undefined> {
    const pane = this.panes[paneIndex]
    if (pane.fileId === null) return undefined

    // Read the name from the DB rather than the cached `files` list, which lags
    // behind by one liveQuery emission right after a file is created.
    const source = await db.files.get(pane.fileId)
    if (!source) return undefined

    this.flush(paneIndex)

    let text: string
    try {
      text = contentToText(pane.content)
    } catch {
      this.setError('Could not copy the file: its content is not valid JSON.')
      return undefined
    }

    // `createFile` resolves name clashes, turning "notes" into "notes (2)".
    const file = await createFile(source.name, text, pane.mode)
    if (file) {
      this.#openFile(paneIndex, file)
      this.#applySyncLock()
    }
    return file
  }

  async deleteFileById(id: number) {
    await deleteFile(id)
    // `#reconcile` moves any pane that had this file open onto a valid one.
  }

  setError(message: string | null) {
    this.errorMessage = message
  }
}

export const store = new EditorStore()
