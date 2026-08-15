import '@testing-library/jest-dom/vitest'
// Provides an in-memory IndexedDB so Dexie works under jsdom.
import 'fake-indexeddb/auto'
import { afterEach, vi } from 'vitest'

// jsdom does not implement these, and svelte-jsoneditor/CodeMirror touch them.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})
