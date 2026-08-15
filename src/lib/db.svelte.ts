import Dexie, { type EntityTable } from 'dexie'
import { Mode, type Content } from 'svelte-jsoneditor'
import { contentToText } from './utils.svelte'

interface FileInfo {
  id?: number
  name: string
  text: string
  mode: Mode
  /** Sort key for the file list; keeps ordering stable and user-controllable. */
  createdAt: number
  updatedAt: number
}

const db = new Dexie('EditorDatabase') as Dexie & {
  files: EntityTable<FileInfo, 'id'>
}

// v1 — original single-record-per-editor layout.
db.version(1).stores({
  editors: 'title, text, mode',
})

// v2 — multi-file storage; copy the old per-editor records into `files`.
db.version(2)
  .stores({
    editors: 'title, text, mode',
    files: '++id, name, text, mode',
  })
  .upgrade(async (tx) => {
    const editors = await tx.table('editors').toArray()
    for (const editor of editors) {
      await tx.table('files').add({
        name: editor.title,
        text: editor.text,
        mode: editor.mode,
      })
    }
  })

// v3 — drop the now-unused `editors` table and stop indexing large blob
// fields (`text`/`mode` were indexed for no reason, doubling stored bytes).
// Adds timestamps so the file list has a stable, meaningful order.
db.version(3)
  .stores({
    editors: null,
    files: '++id, name, createdAt, updatedAt',
  })
  .upgrade(async (tx) => {
    const now = Date.now()
    let seq = 0
    await tx
      .table('files')
      .toCollection()
      .modify((file: FileInfo) => {
        // Preserve existing order by deriving increasing timestamps.
        file.createdAt ??= now + seq
        file.updatedAt ??= now + seq
        seq += 1
      })
  })

/** Reported to the UI when a write fails, so failures are never silent. */
export type DbErrorHandler = (message: string, error: unknown) => void

let onDbError: DbErrorHandler = (message, error) => {
  console.error(message, error)
}

export function setDbErrorHandler(handler: DbErrorHandler) {
  onDbError = handler
}

function reportError(message: string, error: unknown) {
  console.error(message, error)
  onDbError(message, error)
}

export function listFiles(): Promise<FileInfo[]> {
  return db.files.orderBy('createdAt').toArray()
}

/** Outcome of a save attempt, so callers can react to each failure mode. */
export type SaveResult =
  | { status: 'saved'; updatedAt: number }
  | { status: 'missing' }
  | { status: 'failed' }
  /**
   * Someone else (another tab, or the other pane on a different file row)
   * wrote this file since we last read it. The write was *not* applied.
   */
  | { status: 'conflict'; theirs: FileInfo }

/**
 * Persist editor content.
 *
 * When `expectedUpdatedAt` is given the write is a compare-and-set: it only
 * lands if the stored `updatedAt` still matches, which is how a concurrent
 * write from another tab is detected instead of silently clobbered. The read
 * and the write share one transaction so nothing can slip in between.
 */
export async function saveFile(
  id: number,
  content: Content,
  mode: Mode,
  expectedUpdatedAt?: number,
): Promise<SaveResult> {
  let text: string
  try {
    text = contentToText(content)
  } catch (error) {
    reportError('Could not serialize content, changes were not saved.', error)
    return { status: 'failed' }
  }

  try {
    return await db.transaction('rw', db.files, async () => {
      const current = await db.files.get(id)
      if (!current) {
        reportError('The file no longer exists, changes were not saved.', undefined)
        return { status: 'missing' } as SaveResult
      }
      if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) {
        return { status: 'conflict', theirs: current } as SaveResult
      }

      // Monotonic: two writes within the same millisecond must not look equal,
      // or the next compare-and-set could pass against a stale baseline.
      const updatedAt = Math.max(Date.now(), current.updatedAt + 1)
      await db.files.update(id, { text, mode, updatedAt })
      return { status: 'saved', updatedAt } as SaveResult
    })
  } catch (error) {
    reportError('Saving failed. Browser storage may be full or unavailable.', error)
    return { status: 'failed' }
  }
}

/** Build a name that does not collide with an existing file. */
function uniqueName(base: string, existing: FileInfo[]): string {
  const taken = new Set(existing.map((file) => file.name))
  if (!taken.has(base)) return base
  for (let i = 2; ; i += 1) {
    const candidate = `${base} (${i})`
    if (!taken.has(candidate)) return candidate
  }
}

export async function createFile(
  name: string,
  initialText = '{}',
  mode: Mode = Mode.tree,
): Promise<FileInfo | undefined> {
  try {
    const now = Date.now()
    const finalName = uniqueName(name, await db.files.toArray())
    const file: FileInfo = {
      name: finalName,
      text: initialText,
      mode,
      createdAt: now,
      updatedAt: now,
    }
    const id = await db.files.add(file)
    return { ...file, id: id as number }
  } catch (error) {
    reportError('Could not create the file.', error)
    return undefined
  }
}

export async function deleteFile(id: number): Promise<void> {
  try {
    await db.files.delete(id)
  } catch (error) {
    reportError('Could not delete the file.', error)
  }
}

/**
 * Rename a file. Unlike creation, a clash is reported rather than silently
 * suffixed, because the user typed this name deliberately.
 */
export async function renameFile(id: number, name: string): Promise<boolean> {
  try {
    const others = (await db.files.toArray()).filter((file) => file.id !== id)
    if (others.some((file) => file.name === name)) {
      reportError(`Another file is already named "${name}".`, undefined)
      return false
    }
    await db.files.update(id, { name, updatedAt: Date.now() })
    return true
  } catch (error) {
    reportError('Could not rename the file.', error)
    return false
  }
}

export type { FileInfo }
export { db }
