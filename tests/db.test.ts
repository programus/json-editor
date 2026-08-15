import { Mode } from 'svelte-jsoneditor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFile,
  db,
  deleteFile,
  listFiles,
  renameFile,
  saveFile,
  setDbErrorHandler,
} from '../src/lib/db.svelte'

let errors: string[] = []

beforeEach(async () => {
  errors = []
  setDbErrorHandler((message) => errors.push(message))
  // Silence the console noise the error handler also produces.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  if (!db.isOpen()) await db.open()
  await db.files.clear()
})

afterEach(() => {
  setDbErrorHandler((message, error) => console.error(message, error))
})

describe('createFile', () => {
  it('creates a file with timestamps and the requested mode', async () => {
    const file = await createFile('alpha', '{"a":1}', Mode.text)
    expect(file).toBeDefined()
    expect(file).toMatchObject({ name: 'alpha', text: '{"a":1}', mode: Mode.text })
    expect(typeof file!.createdAt).toBe('number')
    expect(typeof file!.updatedAt).toBe('number')
    expect(file!.id).toBeGreaterThan(0)
  })

  it('defaults to tree mode and empty JSON', async () => {
    const file = await createFile('beta')
    expect(file).toMatchObject({ text: '{}', mode: Mode.tree })
  })

  it('suffixes colliding names instead of creating duplicates', async () => {
    await createFile('same')
    const second = await createFile('same')
    const third = await createFile('same')
    expect(second!.name).toBe('same (2)')
    expect(third!.name).toBe('same (3)')
  })

  it('fills gaps in the suffix sequence', async () => {
    await createFile('doc')
    await createFile('doc') // doc (2)
    await db.files.where('name').equals('doc').delete()
    // 'doc' is free again, so it should be reused.
    const next = await createFile('doc')
    expect(next!.name).toBe('doc')
  })
})

describe('listFiles', () => {
  it('returns files ordered by creation time', async () => {
    const a = await createFile('first')
    // Ensure distinct timestamps regardless of clock resolution.
    await db.files.update(a!.id!, { createdAt: 1000 })
    const b = await createFile('second')
    await db.files.update(b!.id!, { createdAt: 2000 })
    const c = await createFile('third')
    await db.files.update(c!.id!, { createdAt: 1500 })

    expect((await listFiles()).map((f) => f.name)).toEqual(['first', 'third', 'second'])
  })

  it('returns an empty array when there are no files', async () => {
    expect(await listFiles()).toEqual([])
  })
})

describe('saveFile', () => {
  it('persists text content verbatim', async () => {
    const file = await createFile('doc')
    const formatted = '{\n    "a":  1\n}'
    const result = await saveFile(file!.id!, { text: formatted }, Mode.text)

    expect(result.status).toBe('saved')
    const stored = await db.files.get(file!.id!)
    expect(stored!.text).toBe(formatted)
    expect(stored!.mode).toBe(Mode.text)
  })

  it('serializes json content', async () => {
    const file = await createFile('doc')
    await saveFile(file!.id!, { json: { a: 1 } }, Mode.tree)
    expect((await db.files.get(file!.id!))!.text).toBe('{\n  "a": 1\n}')
  })

  it('bumps updatedAt', async () => {
    const file = await createFile('doc')
    await db.files.update(file!.id!, { updatedAt: 1 })
    await saveFile(file!.id!, { text: '{}' }, Mode.tree)
    expect((await db.files.get(file!.id!))!.updatedAt).toBeGreaterThan(1)
  })

  it('reports the file as missing when the row no longer exists', async () => {
    const result = await saveFile(99999, { text: '{}' }, Mode.tree)
    expect(result.status).toBe('missing')
    expect(errors.join(' ')).toMatch(/no longer exists/i)
  })

  it('stores invalid JSON text without throwing (edits in progress)', async () => {
    const file = await createFile('doc')
    const result = await saveFile(file!.id!, { text: '{"broken":' }, Mode.text)
    expect(result.status).toBe('saved')
    expect((await db.files.get(file!.id!))!.text).toBe('{"broken":')
  })

  it('returns the new updatedAt so callers can track their baseline', async () => {
    const file = await createFile('doc')
    const result = await saveFile(file!.id!, { text: '{}' }, Mode.tree)

    expect(result.status).toBe('saved')
    const stored = await db.files.get(file!.id!)
    expect(result.status === 'saved' && result.updatedAt).toBe(stored!.updatedAt)
  })

  it('advances updatedAt even for writes within the same millisecond', async () => {
    const file = await createFile('doc')
    const first = await saveFile(file!.id!, { text: '{"a":1}' }, Mode.tree)
    const second = await saveFile(file!.id!, { text: '{"a":2}' }, Mode.tree)

    expect(first.status).toBe('saved')
    expect(second.status).toBe('saved')
    const firstAt = first.status === 'saved' ? first.updatedAt : 0
    const secondAt = second.status === 'saved' ? second.updatedAt : 0
    expect(secondAt).toBeGreaterThan(firstAt)
  })
})

describe('saveFile conflict detection', () => {
  it('applies the write when the expected revision still matches', async () => {
    const file = await createFile('doc')
    const result = await saveFile(file!.id!, { text: '{"mine":1}' }, Mode.tree, file!.updatedAt)

    expect(result.status).toBe('saved')
    expect((await db.files.get(file!.id!))!.text).toBe('{"mine":1}')
  })

  it('refuses the write and reports the stored revision on a stale baseline', async () => {
    const file = await createFile('doc')
    // Simulate another tab writing first.
    await saveFile(file!.id!, { text: '{"theirs":1}' }, Mode.tree)

    const result = await saveFile(file!.id!, { text: '{"mine":1}' }, Mode.tree, file!.updatedAt)

    expect(result.status).toBe('conflict')
    expect(result.status === 'conflict' && result.theirs.text).toBe('{"theirs":1}')
    // Nothing was overwritten.
    expect((await db.files.get(file!.id!))!.text).toBe('{"theirs":1}')
  })

  it('skips the check entirely when no baseline is given', async () => {
    const file = await createFile('doc')
    await saveFile(file!.id!, { text: '{"theirs":1}' }, Mode.tree)

    const result = await saveFile(file!.id!, { text: '{"mine":1}' }, Mode.tree)

    expect(result.status).toBe('saved')
    expect((await db.files.get(file!.id!))!.text).toBe('{"mine":1}')
  })

  it('reports a missing row before checking the baseline', async () => {
    const result = await saveFile(99999, { text: '{}' }, Mode.tree, 123)
    expect(result.status).toBe('missing')
  })
})

describe('renameFile', () => {
  it('renames a file and bumps updatedAt', async () => {
    const file = await createFile('old-name')
    await db.files.update(file!.id!, { updatedAt: 1 })

    const ok = await renameFile(file!.id!, 'new-name')
    expect(ok).toBe(true)

    const stored = await db.files.get(file!.id!)
    expect(stored!.name).toBe('new-name')
    expect(stored!.updatedAt).toBeGreaterThan(1)
  })

  it('rejects a name already used by another file, without silently suffixing', async () => {
    await createFile('taken')
    const other = await createFile('mine')

    const ok = await renameFile(other!.id!, 'taken')
    expect(ok).toBe(false)
    expect(errors.join(' ')).toMatch(/already named/i)
    // The original name must be untouched.
    expect((await db.files.get(other!.id!))!.name).toBe('mine')
  })

  it('allows renaming a file to its own current name', async () => {
    const file = await createFile('self')
    expect(await renameFile(file!.id!, 'self')).toBe(true)
  })
})

describe('deleteFile', () => {
  it('removes the file', async () => {
    const file = await createFile('temp')
    await deleteFile(file!.id!)
    expect(await db.files.get(file!.id!)).toBeUndefined()
  })

  it('deleting a non-existent id is harmless', async () => {
    await deleteFile(4242)
    expect(errors).toEqual([])
  })
})
