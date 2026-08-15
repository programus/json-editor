import { render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { Mode } from 'svelte-jsoneditor'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FileSelectorCombo from '../src/lib/components/FileSelectorCombo.svelte'
import { db, setDbErrorHandler } from '../src/lib/db.svelte'
import { store } from '../src/lib/store.svelte'

/**
 * Seeds files directly and points pane 0 at the first one, bypassing the
 * liveQuery subscription so these tests stay focused on the component.
 */
async function seed(names: string[]) {
  const ids = await db.files.bulkAdd(
    names.map((name, index) => ({
      name,
      text: `"${name}"`,
      mode: Mode.tree,
      createdAt: index + 1,
      updatedAt: index + 1,
    })),
    { allKeys: true },
  )
  store.files = await db.files.orderBy('createdAt').toArray()
  // Open the first file in pane 0, mirroring what the real subscription does.
  store.panes[0].fileId = ids[0] as number
  store.panes[0].content = { text: store.files[0].text }
  store.panes[0].baseUpdatedAt = store.files[0].updatedAt
  return ids as number[]
}

/** Reloads the store's file list after a direct database mutation. */
async function refresh() {
  store.files = await db.files.orderBy('createdAt').toArray()
}

async function openDropdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Toggle file selector' }))
  return screen.getByRole('listbox', { name: 'Files' })
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  setDbErrorHandler(() => {})
  if (!db.isOpen()) await db.open()
  await db.files.clear()
  localStorage.clear()

  store.files = []
  // Panes first: while both show one file the sync lock refuses to release.
  store.panes.forEach((pane) => {
    pane.fileId = null
    pane.content = { text: '{}' }
    pane.baseUpdatedAt = null
  })
  store.setSyncEnabled(false)
  store.setError(null)
  store.conflict = null
})

describe('dropdown', () => {
  it('is closed until the toggle is clicked', async () => {
    const user = userEvent.setup()
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await openDropdown(user)
    expect(screen.getByRole('listbox', { name: 'Files' })).toBeInTheDocument()
  })

  it('lists every file', async () => {
    const user = userEvent.setup()
    await seed(['alpha', 'beta', 'gamma'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const list = await openDropdown(user)
    expect(within(list).getAllByRole('option')).toHaveLength(3)
  })

  it('marks the pane\u2019s current file as selected', async () => {
    const user = userEvent.setup()
    await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const list = await openDropdown(user)
    const selected = within(list)
      .getAllByRole('option')
      .filter((option) => option.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent('alpha')
  })

  it('toggles closed on a second click', async () => {
    const user = userEvent.setup()
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Toggle file selector' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes when clicking outside', async () => {
    const user = userEvent.setup()
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('search', () => {
  it('filters the list as the user types', async () => {
    const user = userEvent.setup()
    await seed(['alpha', 'beta', 'gamma'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const list = await openDropdown(user)
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'a')
    // "alpha" and "gamma" contain an "a"; "beta" also does.
    expect(within(list).getAllByRole('option')).toHaveLength(3)

    await user.clear(screen.getByRole('textbox', { name: 'Search files' }))
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'gam')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    expect(within(list).getByRole('option')).toHaveTextContent('gamma')
  })

  it('matches case-insensitively', async () => {
    const user = userEvent.setup()
    await seed(['Alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const list = await openDropdown(user)
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'ALP')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
  })

  it('shows a placeholder when nothing matches', async () => {
    const user = userEvent.setup()
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'zzz')
    expect(screen.getByText('No files found')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('resets the query when reopened', async () => {
    const user = userEvent.setup()
    await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'zzz')
    await user.keyboard('{Escape}')

    const list = await openDropdown(user)
    expect(screen.getByRole('textbox', { name: 'Search files' })).toHaveValue('')
    expect(within(list).getAllByRole('option')).toHaveLength(2)
  })
})

describe('layout', () => {
  it('stretches across the full width of the toolbar', async () => {
    await seed(['alpha'])
    const { container } = render(FileSelectorCombo, { paneIndex: 0 })

    // The root grows into the toolbar instead of sitting in a narrow column.
    const root = container.querySelector('div')!
    expect(root.className).toMatch(/\bflex-1\b/)
    expect(root.className).toMatch(/\bmin-w-0\b/)
  })

  it('lets the name field fill the bar and ellipsize long names', async () => {
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const input = screen.getByRole('textbox', { name: 'Current file name' })
    expect(input.className).toMatch(/\bflex-1\b/)
    expect(input.className).toMatch(/\bmin-w-0\b/)
    // `truncate` is overflow-hidden + nowrap + text-ellipsis.
    expect(input.className).toMatch(/\btruncate\b/)
    // A fixed width would stop it from filling the bar.
    expect(input.className).not.toMatch(/\bw-40\b/)
  })

  it('shows the whole name in the tooltip when it is cut off', async () => {
    const longName = 'a-very-long-file-name-that-will-not-fit-in-the-toolbar'
    await seed([longName])
    render(FileSelectorCombo, { paneIndex: 0 })

    const input = screen.getByRole('textbox', { name: 'Current file name' })
    await waitFor(() => expect(input).toHaveValue(longName))
    expect(input).toHaveAttribute('title', expect.stringContaining(longName))
  })

  it('opens the dropdown at the full width of the bar', async () => {
    const user = userEvent.setup()
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const list = await openDropdown(user)
    const panel = list.closest('div')!
    expect(panel.className).toMatch(/\bw-full\b/)
  })

  it('ellipsizes long names in the dropdown and keeps them in the tooltip', async () => {
    const user = userEvent.setup()
    const longName = 'another-extremely-long-file-name-for-the-dropdown-list'
    await seed(['alpha', longName])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    const option = screen.getByRole('button', { name: longName })
    expect(option.className).toMatch(/\btruncate\b/)
    expect(option).toHaveAttribute('title', longName)
  })
})

describe('keyboard navigation', () => {
  it('moves down the list with ArrowDown', async () => {
    const user = userEvent.setup()
    await seed(['alpha', 'beta', 'gamma'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('alpha')
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('beta')
  })

  it('wraps around at both ends', async () => {
    const user = userEvent.setup()
    await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    // Focus starts in the search box, so ArrowUp enters at the last option.
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toHaveTextContent('beta')

    // Past the end it wraps back to the top, and vice versa.
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('alpha')
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toHaveTextContent('beta')
  })

  it('only walks the filtered options', async () => {
    const user = userEvent.setup()
    await seed(['alpha', 'beta', 'gamma'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'gam')
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('gamma')
    // A single match means navigation stays put.
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('gamma')
  })

  it('opens the focused file with Enter', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(store.panes[0].fileId).toBe(ids[1])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('selecting a file', () => {
  it('opens the file in the pane and closes the dropdown', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const list = await openDropdown(user)
    await user.click(within(list).getByRole('button', { name: 'beta' }))

    expect(store.panes[0].fileId).toBe(ids[1])
    expect(store.panes[0].content).toEqual({ text: '"beta"' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('creating a file', () => {
  it('adds a file, opens it, and closes the dropdown', async () => {
    const user = userEvent.setup()
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Create new file' }))

    await waitFor(async () => expect(await db.files.count()).toBe(2))
    expect(store.panes[0].content).toEqual({ text: '{}' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('duplicating a file', () => {
  it('creates a copy, opens it, and closes the dropdown', async () => {
    const user = userEvent.setup()
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Duplicate current file' }))

    await waitFor(async () => expect(await db.files.count()).toBe(2))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('copies the content of the original', async () => {
    const user = userEvent.setup()
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Duplicate current file' }))

    await waitFor(async () => expect(await db.files.count()).toBe(2))
    const copy = (await db.files.orderBy('createdAt').toArray())[1]
    expect(copy.text).toBe('"alpha"')
    expect(store.panes[0].content).toEqual({ text: '"alpha"' })
  })

  it('derives the copy name from the original', async () => {
    const user = userEvent.setup()
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Duplicate current file' }))

    await waitFor(async () => expect(await db.files.count()).toBe(2))
    const copy = (await db.files.orderBy('createdAt').toArray())[1]
    expect(copy.name).toBe('alpha (2)')
  })

  it('leaves the original untouched', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Duplicate current file' }))

    await waitFor(async () => expect(await db.files.count()).toBe(2))
    const original = (await db.files.get(ids[0]))!
    expect(original.name).toBe('alpha')
    expect(original.text).toBe('"alpha"')
    // The pane moved to the copy, not the original.
    expect(store.panes[0].fileId).not.toBe(ids[0])
  })

  it('is disabled when no file is open', async () => {
    const user = userEvent.setup()
    // A file exists so the dropdown can open, but the pane points at nothing.
    await seed(['alpha'])
    store.panes[0].fileId = null
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    expect(screen.getByRole('button', { name: 'Duplicate current file' })).toBeDisabled()
  })
})

describe('renaming', () => {
  it('shows the current file name in the input', async () => {
    await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Current file name' })).toHaveValue('alpha'),
    )
  })

  it('is disabled when no file is open', async () => {
    render(FileSelectorCombo, { paneIndex: 0 })
    expect(screen.getByRole('textbox', { name: 'Current file name' })).toBeDisabled()
  })

  it('persists a new name on blur', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const input = screen.getByRole('textbox', { name: 'Current file name' })
    await waitFor(() => expect(input).toHaveValue('alpha'))
    await user.clear(input)
    await user.type(input, 'renamed')
    await user.tab()

    await waitFor(async () => expect((await db.files.get(ids[0]))!.name).toBe('renamed'))
  })

  it('commits on Enter', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const input = screen.getByRole('textbox', { name: 'Current file name' })
    await waitFor(() => expect(input).toHaveValue('alpha'))
    await user.clear(input)
    await user.type(input, 'via-enter{Enter}')

    await waitFor(async () => expect((await db.files.get(ids[0]))!.name).toBe('via-enter'))
  })

  it('reverts on Escape without writing', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const input = screen.getByRole('textbox', { name: 'Current file name' })
    await waitFor(() => expect(input).toHaveValue('alpha'))
    await user.clear(input)
    await user.type(input, 'discard-me{Escape}')

    await waitFor(() => expect(input).toHaveValue('alpha'))
    expect((await db.files.get(ids[0]))!.name).toBe('alpha')
  })

  it('restores the old name when the new one is already taken', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const input = screen.getByRole('textbox', { name: 'Current file name' })
    await waitFor(() => expect(input).toHaveValue('alpha'))
    await user.clear(input)
    await user.type(input, 'beta{Enter}')

    // The rename is rejected, so the input falls back to the original name.
    await waitFor(() => expect(input).toHaveValue('alpha'))
    expect((await db.files.get(ids[0]))!.name).toBe('alpha')
  })

  it('ignores an empty name', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha'])
    render(FileSelectorCombo, { paneIndex: 0 })

    const input = screen.getByRole('textbox', { name: 'Current file name' })
    await waitFor(() => expect(input).toHaveValue('alpha'))
    await user.clear(input)
    await user.type(input, '   {Enter}')

    await waitFor(() => expect(input).toHaveValue('alpha'))
    expect((await db.files.get(ids[0]))!.name).toBe('alpha')
  })
})

describe('delete confirmation dialog', () => {
  it('opens with the file name and both actions', async () => {
    const user = userEvent.setup()
    await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Delete beta' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Delete file "beta"?')
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  /**
   * Regression test: the dialog used to inherit `text-white` from the toolbar,
   * which made the prompt and the Cancel button invisible on the white panel.
   * Every text-bearing node must therefore carry an explicit dark colour.
   */
  it('never leaves its text the same colour as the panel', async () => {
    const user = userEvent.setup()
    await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Delete beta' }))

    const dialog = screen.getByRole('dialog')
    // The dialog panel itself must not rely on inherited (white) text.
    expect(dialog.className).toContain('bg-white')
    expect(dialog.className).toMatch(/\btext-gray-900\b/)

    const prompt = within(dialog).getByText(/Delete file/)
    expect(prompt.className).toMatch(/\btext-gray-900\b/)
    expect(prompt.className).not.toMatch(/\btext-white\b/)

    // Cancel sits directly on the white panel, so it needs dark text too.
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(cancel.className).toMatch(/\btext-gray-900\b/)
    expect(cancel.className).not.toMatch(/\btext-white\b/)

    // Delete is the primary action: white text on the themed (dark) fill.
    const confirm = within(dialog).getByRole('button', { name: 'Delete' })
    expect(confirm.className).toMatch(/\btext-white\b/)
    expect(confirm.className).toMatch(/bg-\(--jse-theme-color\)/)
  })

  it('deletes the file when confirmed', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Delete beta' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(async () => expect(await db.files.get(ids[1])).toBeUndefined())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the file when cancelled', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Delete beta' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await db.files.get(ids[1])).toBeDefined()
  })

  it('is marked up as a modal dialog', async () => {
    const user = userEvent.setup()
    await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    await user.click(screen.getByRole('button', { name: 'Delete beta' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName()
  })
})

describe('reacting to external changes', () => {
  it('drops a deleted file from the list', async () => {
    const user = userEvent.setup()
    const ids = await seed(['alpha', 'beta'])
    render(FileSelectorCombo, { paneIndex: 0 })

    await openDropdown(user)
    expect(screen.getAllByRole('option')).toHaveLength(2)

    await db.files.delete(ids[1])
    await refresh()

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
  })
})
