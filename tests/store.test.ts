import { Mode } from 'svelte-jsoneditor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, setDbErrorHandler } from '../src/lib/db.svelte'
import { store } from '../src/lib/store.svelte'

/** Yields to the event loop so pending microtasks and timers can run. */
async function tick(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Polls until `predicate` holds, so tests wait only as long as necessary
 * instead of sleeping for a fixed worst-case duration.
 */
async function waitFor(predicate: () => boolean | Promise<boolean>, timeout = 2000) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await predicate()) return
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await tick(5)
  }
}

/** Waits for the file list in the store to reach the expected length. */
async function waitForFiles(count: number) {
  await waitFor(() => (store.files?.length ?? -1) === count)
}

/** Waits until the persisted text of a file matches `expected`. */
async function waitForText(fileId: number, expected: string) {
  await waitFor(async () => (await db.files.get(fileId))?.text === expected)
}

/** Waits until both panes point at an existing file. */
async function waitForPanesReady() {
  await waitFor(
    () =>
      store.panes.every(
        (pane) => pane.fileId !== null && (store.files ?? []).some((f) => f.id === pane.fileId),
      ),
  )
}

let teardown: (() => void) | undefined

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  setDbErrorHandler(() => {})
  if (!db.isOpen()) await db.open()
  await db.files.clear()
  localStorage.clear()

  // Reset shared store state between tests. Panes come first: with both panes
  // on one file the sync lock would refuse to release.
  store.panes.forEach((pane) => {
    pane.fileId = null
    pane.content = { text: '{}' }
    pane.baseUpdatedAt = null
  })
  store.panes[0].mode = Mode.text
  store.panes[1].mode = Mode.tree
  store.setSyncEnabled(false)
  store.setError(null)
  store.conflict = null
})

afterEach(() => {
  teardown?.()
  teardown = undefined
})

describe('initial load', () => {
  it('auto-creates exactly one file when the database is empty', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    expect(await db.files.count()).toBe(1)
    expect(store.files).toHaveLength(1)
    expect(store.panes[0].fileId).not.toBeNull()
    // Both panes land on the only file available.
    expect(store.panes[1].fileId).toBe(store.panes[0].fileId)
  })

  it('does not create duplicates across repeated emissions', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    // Trigger more liveQuery emissions and let the store reconcile each one.
    const stamp = Date.now() + 1
    await db.files.update(store.panes[0].fileId!, { updatedAt: stamp })
    await waitFor(() => store.files?.[0]?.updatedAt === stamp)
    await tick(50)

    expect(await db.files.count()).toBe(1)
  })

  it('opens different files in each pane when several exist', async () => {
    await db.files.bulkAdd([
      { name: 'a', text: '"A"', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
      { name: 'b', text: '"B"', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
    ])
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    expect(store.nameFor(0)).toBe('a')
    expect(store.nameFor(1)).toBe('b')
  })

  it('loads the stored text into the pane', async () => {
    await db.files.add({
      name: 'doc',
      text: '{"loaded":true}',
      mode: Mode.tree,
      createdAt: 1,
      updatedAt: 1,
    })
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    expect(store.panes[0].content).toEqual({ text: '{"loaded":true}' })
  })

  it('restores each pane to its previously open file', async () => {
    const ids = await db.files.bulkAdd(
      [
        { name: 'a', text: '"A"', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
        { name: 'b', text: '"B"', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
      ],
      { allKeys: true },
    )
    // Pane 0 previously had the *second* file open.
    localStorage.setItem('current-file-id-pane-0', String(ids[1]))
    localStorage.setItem('current-file-id-pane-1', String(ids[0]))

    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    expect(store.nameFor(0)).toBe('b')
    expect(store.nameFor(1)).toBe('a')
  })

  it('falls back gracefully when the stored id no longer exists', async () => {
    await db.files.add({ name: 'only', text: '{}', mode: Mode.tree, createdAt: 1, updatedAt: 1 })
    localStorage.setItem('current-file-id-pane-0', '99999')

    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    expect(store.nameFor(0)).toBe('only')
  })

  it('ignores a corrupt stored id', async () => {
    await db.files.add({ name: 'only', text: '{}', mode: Mode.tree, createdAt: 1, updatedAt: 1 })
    localStorage.setItem('current-file-id-pane-0', 'not-a-number')

    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    expect(store.nameFor(0)).toBe('only')
  })

  it("adopts the file's saved mode", async () => {
    await db.files.add({ name: 'doc', text: '{}', mode: Mode.table, createdAt: 1, updatedAt: 1 })
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    expect(store.panes[0].mode).toBe(Mode.table)
  })
})

describe('autosave', () => {
  it('debounces and persists edits', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const fileId = store.panes[0].fileId!

    store.handleChange(0, { text: '{"a":1}' }, false)
    store.handleChange(0, { text: '{"a":2}' }, false)
    store.handleChange(0, { text: '{"a":3}' }, false)

    // Still debounced immediately after the calls.
    expect((await db.files.get(fileId))!.text).toBe('{}')

    // Only the final value is written once the debounce elapses.
    await waitForText(fileId, '{"a":3}')
  })

  it('flush writes pending changes immediately', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const fileId = store.panes[0].fileId!

    store.handleChange(0, { text: '{"flushed":true}' }, false)
    store.flush(0)

    await waitForText(fileId, '{"flushed":true}')
  })

  it('persists invalid JSON so in-progress edits are not lost', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const fileId = store.panes[0].fileId!

    store.handleChange(0, { text: '{"incomplete":' }, true)
    store.flush(0)

    await waitForText(fileId, '{"incomplete":')
  })

  it('records a mode change without reformatting the stored text', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const fileId = store.panes[0].fileId!

    const handFormatted = '{\n    "a":   1\n}'
    store.handleChange(0, { text: handFormatted }, false)
    store.flush(0)
    await waitForText(fileId, handFormatted)

    store.handleModeChange(0, Mode.tree)
    store.flush(0)
    await waitFor(async () => (await db.files.get(fileId))?.mode === Mode.tree)

    const stored = await db.files.get(fileId)
    expect(stored!.mode).toBe(Mode.tree)
    // The user's formatting must survive the mode switch.
    expect(stored!.text).toBe(handFormatted)
  })

  it('does not write when no file is open', async () => {
    // No subscription, so no file is assigned.
    store.handleChange(0, { text: '{"orphan":1}' }, false)
    store.flush(0)
    await tick(50)

    expect(await db.files.count()).toBe(0)
  })
})

describe('sync', () => {
  it('persists the enabled flag to localStorage', () => {
    store.setSyncEnabled(true)
    expect(localStorage.getItem('sync-contents')).toBe('true')
    store.setSyncEnabled(false)
    expect(localStorage.getItem('sync-contents')).toBe('false')
  })

  it('mirrors edits to the other pane when enabled', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    store.setSyncEnabled(true)

    store.handleChange(0, { text: '{"mirrored":true}' }, false)
    expect(store.panes[1].content).toEqual({ text: '{"mirrored":true}' })
  })

  it('gives the other pane its own object, not a shared reference', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    store.setSyncEnabled(true)

    const source = { text: '{"shared":false}' }
    store.handleChange(0, source, false)

    expect(store.panes[1].content).not.toBe(store.panes[0].content)
    expect(store.panes[1].content).not.toBe(source)
  })

  it('does not mirror when disabled', async () => {
    // Two files, so the panes land on different ones and sync is not locked on.
    await db.files.bulkAdd([
      { name: 'a', text: '"A"', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
      { name: 'b', text: '"B"', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
    ])
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    store.setSyncEnabled(false)
    expect(store.syncEnabled).toBe(false)

    store.handleChange(0, { text: '{"solo":true}' }, false)
    expect(store.panes[1].content).not.toEqual({ text: '{"solo":true}' })
  })

  it('does not mirror content that has errors', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    store.setSyncEnabled(true)
    const before = store.panes[1].content

    store.handleChange(0, { text: '{"broken":' }, true)
    expect(store.panes[1].content).toEqual(before)
  })

  it('mirrors in both directions', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    store.setSyncEnabled(true)

    store.handleChange(1, { text: '{"fromRight":1}' }, false)
    expect(store.panes[0].content).toEqual({ text: '{"fromRight":1}' })
  })

  it('persists the mirrored content to the other pane\u2019s file', async () => {
    await db.files.bulkAdd([
      { name: 'a', text: '{}', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
      { name: 'b', text: '{}', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
    ])
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    store.setSyncEnabled(true)

    const otherFileId = store.panes[1].fileId!
    store.handleChange(0, { text: '{"synced":1}' }, false)
    store.flush()

    await waitForText(otherFileId, '{"synced":1}')
  })
})

/** Seeds two files and returns their ids in creation order. */
async function seedTwoFiles() {
  const ids = await db.files.bulkAdd(
    [
      { name: 'a', text: '{"a":1}', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
      { name: 'b', text: '{"b":1}', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
    ],
    { allKeys: true },
  )
  return ids as number[]
}

describe('sync lock', () => {
  it('locks and enables sync when both panes open the same file', async () => {
    // A single file means both panes land on it.
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    expect(store.panes[0].fileId).toBe(store.panes[1].fileId)
    expect(store.syncLocked).toBe(true)
    expect(store.syncEnabled).toBe(true)
  })

  it('is not locked while the panes show different files', async () => {
    await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    expect(store.syncLocked).toBe(false)
    expect(store.syncEnabled).toBe(false)
  })

  it('refuses to turn sync off while locked', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    store.setSyncEnabled(false)
    expect(store.syncEnabled).toBe(true)
  })

  it('releases the lock and turns sync off when a pane moves to another file', async () => {
    await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    // Put both panes on file "a" to engage the lock.
    store.selectFile(1, store.files!.find((file) => file.name === 'a')!)
    expect(store.syncLocked).toBe(true)
    expect(store.syncEnabled).toBe(true)

    store.selectFile(1, store.files!.find((file) => file.name === 'b')!)
    expect(store.syncLocked).toBe(false)
    expect(store.syncEnabled).toBe(false)
  })

  it('does not restore a manual sync that predated the lock', async () => {
    await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    store.selectFile(1, store.files!.find((file) => file.name === 'a')!)
    store.selectFile(1, store.files!.find((file) => file.name === 'b')!)

    // Leaving a shared file always turns sync off; the user re-enables by hand.
    expect(store.syncEnabled).toBe(false)
  })

  it('releases the lock when a pane switches to a brand new file', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    expect(store.syncLocked).toBe(true)

    await store.createAndOpen(1)
    expect(store.syncLocked).toBe(false)
    expect(store.syncEnabled).toBe(false)
  })

  it('releases the lock when a pane switches to a duplicate', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    expect(store.syncLocked).toBe(true)

    await store.duplicateAndOpen(1)
    expect(store.syncLocked).toBe(false)
    expect(store.syncEnabled).toBe(false)
  })

  it('engages the lock when the panes end up on one file after a deletion', async () => {
    const ids = await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    expect(store.syncLocked).toBe(false)

    // Pane 1 loses its file and falls back onto pane 0's.
    await store.deleteFileById(ids[1])
    await waitForFiles(1)
    await waitFor(() => store.panes[1].fileId === ids[0])

    expect(store.syncLocked).toBe(true)
    expect(store.syncEnabled).toBe(true)
  })

  it('writes the shared row only once per edit while locked', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    expect(store.syncLocked).toBe(true)

    const update = vi.spyOn(db.files, 'update')
    store.handleChange(0, { text: '{"once":1}' }, false)
    store.flush()
    await waitForText(store.panes[0].fileId!, '{"once":1}')

    expect(update).toHaveBeenCalledTimes(1)
    update.mockRestore()
  })

  it('still writes both files when syncing two different files', async () => {
    const ids = await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    store.setSyncEnabled(true)

    store.handleChange(0, { text: '{"both":1}' }, false)
    store.flush()

    await waitForText(ids[0], '{"both":1}')
    await waitForText(ids[1], '{"both":1}')
  })
})

describe('cross-tab conflicts', () => {
  it('reports a conflict instead of overwriting another tab\u2019s write', async () => {
    await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const fileId = store.panes[0].fileId!

    // Simulate another tab writing straight to the row.
    await db.files.update(fileId, { text: '{"theirs":1}', updatedAt: Date.now() + 5000 })

    store.handleChange(0, { text: '{"mine":1}' }, false)
    store.flush(0)
    await waitFor(() => store.conflict !== null)

    expect(store.conflict!.fileId).toBe(fileId)
    expect(store.conflict!.paneIndex).toBe(0)
    // The other tab's text survived.
    expect((await db.files.get(fileId))!.text).toBe('{"theirs":1}')
  })

  it('keeps our edit when the user chooses to overwrite', async () => {
    await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const fileId = store.panes[0].fileId!

    await db.files.update(fileId, { text: '{"theirs":1}', updatedAt: Date.now() + 5000 })
    store.handleChange(0, { text: '{"mine":1}' }, false)
    store.flush(0)
    await waitFor(() => store.conflict !== null)

    store.resolveConflictWithOurs()
    await waitForText(fileId, '{"mine":1}')
    expect(store.conflict).toBeNull()
  })

  it('adopts the other revision when the user chooses to reload', async () => {
    await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const fileId = store.panes[0].fileId!

    await db.files.update(fileId, { text: '{"theirs":1}', updatedAt: Date.now() + 5000 })
    store.handleChange(0, { text: '{"mine":1}' }, false)
    store.flush(0)
    await waitFor(() => store.conflict !== null)

    store.resolveConflictWithTheirs()
    expect(store.conflict).toBeNull()
    expect(store.panes[0].content).toEqual({ text: '{"theirs":1}' })
    expect((await db.files.get(fileId))!.text).toBe('{"theirs":1}')
  })

  it('a second edit after overwriting does not conflict again', async () => {
    await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const fileId = store.panes[0].fileId!

    await db.files.update(fileId, { text: '{"theirs":1}', updatedAt: Date.now() + 5000 })
    store.handleChange(0, { text: '{"mine":1}' }, false)
    store.flush(0)
    await waitFor(() => store.conflict !== null)
    store.resolveConflictWithOurs()
    await waitForText(fileId, '{"mine":1}')

    store.handleChange(0, { text: '{"mine":2}' }, false)
    store.flush(0)
    await waitForText(fileId, '{"mine":2}')
    expect(store.conflict).toBeNull()
  })

  it('does not flag a conflict for an external write the pane has no edits against', async () => {
    await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const fileId = store.panes[0].fileId!
    const theirText = store.panes[0].content as { text: string }

    // Another tab rewrites the row with the same text the pane already shows.
    await db.files.update(fileId, { text: theirText.text, updatedAt: Date.now() + 5000 })
    await waitFor(() => store.panes[0].baseUpdatedAt !== 1)

    store.handleChange(0, { text: '{"mine":1}' }, false)
    store.flush(0)
    await waitForText(fileId, '{"mine":1}')
    expect(store.conflict).toBeNull()
  })

  it('does not adopt an external revision while the pane has unsaved edits', async () => {
    await seedTwoFiles()
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const fileId = store.panes[0].fileId!

    store.handleChange(0, { text: '{"mine":1}' }, false)
    await db.files.update(fileId, { text: '{"theirs":1}', updatedAt: Date.now() + 5000 })
    await waitFor(async () => (await db.files.get(fileId))!.text === '{"theirs":1}')

    // The pane keeps showing the user's edit rather than being yanked away.
    expect(store.panes[0].content).toEqual({ text: '{"mine":1}' })
  })
})

describe('copyContent', () => {
  it('copies left to right without sharing the object', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    store.handleChange(0, { text: '{"src":1}' }, false)
    store.copyContent(0, 1)

    expect(store.panes[1].content).toEqual({ text: '{"src":1}' })
    expect(store.panes[1].content).not.toBe(store.panes[0].content)
  })

  it('copies right to left', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    store.handleChange(1, { text: '{"fromRight":1}' }, false)
    store.copyContent(1, 0)

    expect(store.panes[0].content).toEqual({ text: '{"fromRight":1}' })
  })

  it('leaves the panes independent after a copy', async () => {
    await db.files.bulkAdd([
      { name: 'a', text: '{}', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
      { name: 'b', text: '{}', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
    ])
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    store.handleChange(0, { text: '{"v":1}' }, false)
    store.copyContent(0, 1)
    // Editing the right pane afterwards must not affect the left one.
    store.handleChange(1, { text: '{"v":2}' }, false)

    expect(store.panes[0].content).toEqual({ text: '{"v":1}' })
    expect(store.panes[1].content).toEqual({ text: '{"v":2}' })
  })
})

describe('file management', () => {
  it('creating a file opens it in that pane and preserves history', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    const firstId = store.panes[0].fileId!
    store.handleChange(0, { text: '{"old":true}' }, false)
    store.flush(0)
    await waitForText(firstId, '{"old":true}')

    const created = await store.createAndOpen(0)
    await waitForFiles(2)

    expect(created).toBeDefined()
    expect(store.panes[0].fileId).toBe(created!.id)
    expect(await db.files.count()).toBe(2)
    // The previous file keeps its content: this is the history feature.
    expect((await db.files.get(firstId))!.text).toBe('{"old":true}')
  })

  it('a new file starts from empty JSON', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    await store.createAndOpen(0)
    expect(store.panes[0].content).toEqual({ text: '{}' })
  })

  it('creating a file cancels a pending save for the old file', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const firstId = store.panes[0].fileId!

    store.handleChange(0, { text: '{"unsaved":true}' }, false)
    // Switch files before the debounce elapses.
    await store.createAndOpen(0)
    await waitForFiles(2)
    // Wait past the debounce window to prove the pending write was cancelled.
    await tick(500)

    // The pending edit must not leak into either file.
    expect((await db.files.get(firstId))!.text).toBe('{}')
    expect(store.panes[0].content).toEqual({ text: '{}' })
  })

  it('duplicating copies the content into a new file and opens it', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const originalId = store.panes[0].fileId!

    store.handleChange(0, { text: '{"original":true}' }, false)
    store.flush(0)
    await waitForText(originalId, '{"original":true}')

    const copy = await store.duplicateAndOpen(0)
    await waitForFiles(2)

    expect(copy).toBeDefined()
    expect(copy!.text).toBe('{"original":true}')
    expect(store.panes[0].fileId).toBe(copy!.id)
    // The original survives untouched: that is the point of duplicating.
    expect((await db.files.get(originalId))!.text).toBe('{"original":true}')
  })

  it('duplicating captures edits still inside the debounce window', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const originalId = store.panes[0].fileId!

    // Not yet persisted when the copy is made.
    store.handleChange(0, { text: '{"unsaved":true}' }, false)
    const copy = await store.duplicateAndOpen(0)
    await waitForFiles(2)

    // Both the copy and the original must contain the pending edit.
    expect(copy!.text).toBe('{"unsaved":true}')
    await waitForText(originalId, '{"unsaved":true}')
  })

  it('duplicating preserves the pane mode', async () => {
    await db.files.add({ name: 'doc', text: '{}', mode: Mode.table, createdAt: 1, updatedAt: 1 })
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    const copy = await store.duplicateAndOpen(0)
    expect(copy!.mode).toBe(Mode.table)
    expect(store.panes[0].mode).toBe(Mode.table)
  })

  it('duplicating names the copy after the original', async () => {
    await db.files.add({ name: 'notes', text: '{}', mode: Mode.tree, createdAt: 1, updatedAt: 1 })
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    const first = await store.duplicateAndOpen(0)
    expect(first!.name).toBe('notes (2)')

    // Duplicating the copy must not collide with the names already taken.
    const second = await store.duplicateAndOpen(0)
    expect(second!.name).toBe('notes (2) (2)')
    expect(await db.files.count()).toBe(3)
  })

  it('duplicating keeps invalid JSON text as-is', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    // Text mode stores whatever the user typed, valid or not.
    store.handleChange(0, { text: '{"broken":' }, true)
    const copy = await store.duplicateAndOpen(0)

    expect(copy!.text).toBe('{"broken":')
    expect(store.errorMessage).toBeNull()
  })

  it('duplicating does nothing when no file is open', async () => {
    // No subscription, so the pane has no file.
    const copy = await store.duplicateAndOpen(0)

    expect(copy).toBeUndefined()
    expect(await db.files.count()).toBe(0)
  })

  it('duplicating leaves the other pane alone', async () => {
    await db.files.bulkAdd([
      { name: 'a', text: '"A"', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
      { name: 'b', text: '"B"', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
    ])
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    const paneOneId = store.panes[1].fileId!

    await store.duplicateAndOpen(0)
    await waitForFiles(3)

    expect(store.panes[1].fileId).toBe(paneOneId)
    expect(store.panes[1].content).toEqual({ text: '"B"' })
  })

  it('selectFile loads the chosen file into the pane', async () => {
    await db.files.bulkAdd([
      { name: 'a', text: '"A"', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
      { name: 'b', text: '"B"', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
    ])
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    const target = store.files!.find((f) => f.name === 'b')!
    store.selectFile(0, target)

    expect(store.panes[0].fileId).toBe(target.id)
    expect(store.panes[0].content).toEqual({ text: '"B"' })
    expect(localStorage.getItem('current-file-id-pane-0')).toBe(String(target.id))
  })

  it('selectFile mirrors to the other pane while sync is on', async () => {
    await db.files.bulkAdd([
      { name: 'a', text: '"A"', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
      { name: 'b', text: '"B"', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
    ])
    teardown = store.subscribeToFiles()
    await waitForPanesReady()
    store.setSyncEnabled(true)

    store.selectFile(0, store.files!.find((f) => f.name === 'b')!)
    expect(store.panes[1].content).toEqual({ text: '"B"' })
  })
})

describe('deletion recovery', () => {
  it('moves a pane onto a surviving file when its file is deleted', async () => {
    await db.files.bulkAdd([
      { name: 'a', text: '"A"', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
      { name: 'b', text: '"B"', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
    ])
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    const deletedId = store.panes[1].fileId!
    expect(store.nameFor(1)).toBe('b')

    await store.deleteFileById(deletedId)
    await waitFor(() => store.panes[1].fileId !== deletedId)

    expect(store.panes[1].fileId).not.toBe(deletedId)
    expect(store.nameFor(1)).toBe('a')
    expect(store.panes[1].content).toEqual({ text: '"A"' })
  })

  it('recreates a file when the last one is deleted', async () => {
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    const deletedId = store.panes[0].fileId!
    await store.deleteFileById(deletedId)
    // The store must observe the empty list, then auto-create a replacement.
    await waitFor(() => store.files?.length === 1 && store.files[0].id !== deletedId)
    await waitForPanesReady()

    expect(await db.files.count()).toBe(1)
    expect(store.panes[0].fileId).not.toBeNull()
    expect(store.files!.some((f) => f.id === store.panes[0].fileId)).toBe(true)
  })

  it('leaves the other pane untouched when it had a different file', async () => {
    await db.files.bulkAdd([
      { name: 'a', text: '"A"', mode: Mode.tree, createdAt: 1, updatedAt: 1 },
      { name: 'b', text: '"B"', mode: Mode.tree, createdAt: 2, updatedAt: 2 },
    ])
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    const paneZeroId = store.panes[0].fileId!
    const deletedId = store.panes[1].fileId!
    await store.deleteFileById(deletedId)
    await waitFor(() => !store.files?.some((f) => f.id === deletedId))

    expect(store.panes[0].fileId).toBe(paneZeroId)
  })
})

describe('error reporting', () => {
  it('surfaces database errors to the UI', async () => {
    setDbErrorHandler((message) => store.setError(message))
    teardown = store.subscribeToFiles()
    await waitForPanesReady()

    // Saving to a missing row must produce a user-visible message.
    store.panes[0].fileId = 99999
    store.handleChange(0, { text: '{"missing":1}' }, false)
    store.flush(0)
    await waitFor(() => store.errorMessage !== null)

    expect(store.errorMessage).toMatch(/no longer exists/i)
  })

  it('setError(null) clears the message', () => {
    store.setError('boom')
    expect(store.errorMessage).toBe('boom')
    store.setError(null)
    expect(store.errorMessage).toBeNull()
  })
})
