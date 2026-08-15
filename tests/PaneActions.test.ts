import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PaneActions from '../src/lib/components/PaneActions.svelte'
import { setDbErrorHandler } from '../src/lib/db.svelte'
import { store } from '../src/lib/store.svelte'

const syncButton = () => screen.getByRole('button', { name: '↔' })
const copyRightToLeft = () => screen.getByTitle('Copy right to left')
const copyLeftToRight = () => screen.getByTitle('Copy left to right')

/** Puts both panes on distinct in-memory content without touching the DB. */
function setContents(left: string, right: string) {
  store.panes[0].content = { text: left }
  store.panes[1].content = { text: right }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  setDbErrorHandler(() => {})
  localStorage.clear()

  store.setSyncEnabled(false)
  store.setError(null)
  // No file is open, so nothing is persisted by these tests.
  store.panes.forEach((pane) => {
    pane.fileId = null
    pane.content = { text: '{}' }
  })
})

describe('copy buttons', () => {
  it('copies left to right', async () => {
    const user = userEvent.setup()
    setContents('{"a":1}', '{"b":2}')
    render(PaneActions)

    await user.click(copyLeftToRight())
    expect(store.panes[1].content).toEqual({ text: '{"a":1}' })
    expect(store.panes[0].content).toEqual({ text: '{"a":1}' })
  })

  it('copies right to left', async () => {
    const user = userEvent.setup()
    setContents('{"a":1}', '{"b":2}')
    render(PaneActions)

    await user.click(copyRightToLeft())
    expect(store.panes[0].content).toEqual({ text: '{"b":2}' })
  })

  it('does not make the panes share one object', async () => {
    const user = userEvent.setup()
    setContents('{"a":1}', '{"b":2}')
    render(PaneActions)

    await user.click(copyLeftToRight())
    expect(store.panes[1].content).not.toBe(store.panes[0].content)
  })
})

describe('sync toggle', () => {
  it('enables sync when both panes already match', async () => {
    const user = userEvent.setup()
    setContents('{"a":1}', '{"a":1}')
    render(PaneActions)

    await user.click(syncButton())
    expect(store.syncEnabled).toBe(true)
    expect(store.errorMessage).toBeNull()
    expect(syncButton()).toHaveAttribute('aria-pressed', 'true')
  })

  it('ignores formatting and key order when comparing', async () => {
    const user = userEvent.setup()
    setContents('{"a":1,"b":2}', '{\n  "b": 2,\n  "a": 1\n}')
    render(PaneActions)

    await user.click(syncButton())
    expect(store.syncEnabled).toBe(true)
  })

  it('refuses to enable sync when the contents differ', async () => {
    const user = userEvent.setup()
    setContents('{"a":1}', '{"a":2}')
    render(PaneActions)

    await user.click(syncButton())
    expect(store.syncEnabled).toBe(false)
    expect(store.errorMessage).toMatch(/different contents/i)
  })

  it('refuses to enable sync when one side is invalid JSON', async () => {
    const user = userEvent.setup()
    setContents('{"a":1}', '{"a":')
    render(PaneActions)

    await user.click(syncButton())
    expect(store.syncEnabled).toBe(false)
    expect(store.errorMessage).toMatch(/invalid JSON/i)
  })

  it('always allows turning sync back off', async () => {
    const user = userEvent.setup()
    // Contents differ, which would block enabling, but disabling must still work.
    setContents('{"a":1}', '{"a":2}')
    store.setSyncEnabled(true)
    render(PaneActions)

    await user.click(syncButton())
    expect(store.syncEnabled).toBe(false)
    expect(store.errorMessage).toBeNull()
  })

  it('reflects the current state in aria-pressed and the tooltip', async () => {
    setContents('{}', '{}')
    render(PaneActions)

    expect(syncButton()).toHaveAttribute('aria-pressed', 'false')
    expect(syncButton()).toHaveAttribute('title', expect.stringContaining('OFF'))
  })
})
