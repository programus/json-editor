---
description: "Use when writing or editing any Svelte component, TypeScript module, or utility file in this project. Covers Svelte 5 runes, component prop patterns, Tailwind v4 styling, and project-specific libraries."
applyTo: "{src,tests}/**/*.{svelte,ts}"
---

# Project Conventions

## Tech Stack

- **Svelte 5** (runes-based: `$state`, `$effect`, `$derived`, `$props`, `$bindable`)
- **TypeScript** — strict typing throughout
- **Tailwind CSS v4** — inline utility classes, CSS variable refs use `bg-(--var-name)` syntax
- **svelte-jsoneditor** — JSON editing core
- **dexie** — IndexedDB wrapper; use `liveQuery` for reactive queries
- **lossless-json** — JSON parsing to preserve large-number precision; use instead of `JSON.parse`/`JSON.stringify` where JSON content is handled
- **svelte-splitpanes** — split pane layout
- **svelte-fa** + `@fortawesome/free-solid-svg-icons` — icon rendering

## Svelte 5 Runes

Always use runes — never use legacy `export let`, stores, or `$:` reactive statements.

```ts
// State
let count = $state(0)

// Derived
const doubled = $derived(count * 2)

// Side effects
$effect(() => {
  localStorage.setItem('key', String(count))
})
```

## Component Prop Pattern

Define props with an explicit interface, then destructure via `$props()`:

```svelte
<script lang="ts">
  interface MyComponentProps {
    value: string
    onChange?: (v: string) => void
    optional?: boolean
  }

  let {
    value = $bindable(''),
    onChange,
    optional = false,
  }: MyComponentProps = $props()
</script>
```

- Use `$bindable()` for two-way bindable props
- Use callback props (`onXxx: () => void`) instead of Svelte `createEventDispatcher` or `dispatch`
- Use `...otherProps` spread to forward extra props to underlying components

## Reactive Modules (.svelte.ts)

Files that use runes outside of `.svelte` components must use the `.svelte.ts` extension.
Runes are compiler keywords — never import them:

```ts
// src/lib/store.svelte.ts
class EditorStore {
  files = $state<FileInfo[] | undefined>(undefined) // no import needed
}
```

Plain `.ts` files must NOT use runes.

## Dexie / liveQuery Pattern

Use `liveQuery` for reactive IndexedDB reads; the returned store is accessed with the `$` prefix in Svelte:

```svelte
<script lang="ts">
  import { liveQuery } from 'dexie'
  import { db } from '../db.svelte'

  let savedData = liveQuery(async () => db.editors.get('my-key'))

  $effect(() => {
    if ($savedData) {
      // use $savedData
    }
  })
</script>
```

## JSON Content Handling

- Always use `lossless-json`'s `parse`/`stringify` when reading or writing JSON editor content
- Use `isJSONContent` / `toJSONContent` from `svelte-jsoneditor` to check and convert content types
- When serializing for storage: prefer `text` representation; fall back to `stringify(toJSONContent(content).json)`

## Tailwind CSS v4

- Use utility classes directly in templates — no separate CSS files for component styles
- Reference CSS custom properties with parenthesis syntax: `bg-(--jse-theme-color)`, `hover:bg-(--jse-theme-color-highlight)`
- For conditional classes, use template literals: `class="{condition ? 'active-class' : ''} base-class"`

## State Persistence

- UI settings (`sync-contents`, per-pane `current-file-id-pane-N`): `localStorage`
- Editor content: Dexie `db.files` (one row per file, schema v3)
- All shared state lives in `src/lib/store.svelte.ts`; components read/write it
  directly instead of threading props and callbacks through each other
- Writes are debounced through the store; never call `db` directly from a component

## Third-Party Editor Boundary

`svelte-jsoneditor` and `svelte-splitpanes` are used through their public APIs
only. Do NOT `querySelector` into their internal DOM (`.jse-menu`,
`.splitpanes__splitter`) or `mount()` components inside it — those class names
are private and break on upgrades. Custom UI belongs in our own wrapper markup
(see `EditorPane.svelte`); extra menu buttons go through `onRenderMenu`, which
only accepts `button`/`separator`/`space` items.

## Testing

Vitest (jsdom) plus `@testing-library/svelte`. Dexie runs against
`fake-indexeddb`, wired up in `tests/setup.ts`. Test config lives in
`vitest.config.ts`, kept separate from `vite.config.ts` because Vite's
`defineConfig` does not accept a `test` block.

```sh
npm test            # single run, the regression suite
npm run test:watch  # re-run on change while developing
npm run verify      # typecheck + tests + production build
```

Rules for new tests:

- Never `await` a fixed sleep. Poll for the condition instead (see the `waitFor`
  helpers in `tests/store.test.ts`), or the suite gets slow and flaky.
- `store` is a module-level singleton, so reset panes, sync, error and
  `db.files` in `beforeEach`; otherwise tests leak into each other.
- Query by role or accessible name, not by CSS class, so tests survive restyling.
- Assert on colour classes only for the delete dialog, where an inherited
  `text-white` once made the text invisible; that check is a deliberate
  regression guard.
- `EditorPane.svelte` is deliberately untested: it is a thin wrapper whose body
  is the third-party `JSONEditor`, which needs a real browser to mount.

## File Organization

```
src/
  lib/
    components/
      EditorPane.svelte        # One pane: toolbar + JSONEditor
      FileSelectorCombo.svelte # File dropdown / rename / create / delete
      PaneActions.svelte       # Copy + sync buttons between panes
    db.svelte.ts     # Dexie schema and CRUD helpers
    store.svelte.ts  # Single source of truth for shared app state
    utils.svelte.ts  # Pure helpers (content compare, serialize, debounce)
  App.svelte         # Layout + global error toast
  main.ts            # Entry point
tests/
  setup.ts                     # jest-dom, fake-indexeddb, jsdom shims
  utils.test.ts                # Pure helpers
  db.test.ts                   # Dexie CRUD
  store.test.ts                # Load, autosave, sync, deletion recovery
  FileSelectorCombo.test.ts    # Dropdown, search, rename, delete dialog
  PaneActions.test.ts          # Copy buttons and the sync guard
```
