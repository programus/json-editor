import { isJSONContent, toJSONContent, type Content } from 'svelte-jsoneditor'
import { parse, stringify } from 'lossless-json'

/** Shared lossless-json parser instance handed to every JSONEditor. */
export const LosslessJSONParser = { parse, stringify }

/**
 * Always return a fresh object. A shared module-level constant would be
 * aliased by both editor panes, so an in-place mutation on one side would
 * leak into the other.
 */
export function createDefaultContent(): Content {
  return { text: '{}' }
}

/**
 * Shallow-copy content so two panes never share one object.
 *
 * Only the wrapper is copied: the inner `json` value is treated as immutable
 * (svelte-jsoneditor replaces it on every change rather than mutating it), so a
 * deep clone would be wasted work on large documents.
 */
export function cloneContent(content: Content): Content {
  return isJSONContent(content) ? { json: content.json } : { text: content.text }
}

/**
 * Serialize editor content to the string we persist.
 *
 * Text content is stored verbatim so the user's own formatting survives a
 * round trip; only JSON (tree/table) content needs to be stringified.
 * Uses lossless-json to preserve large-number precision.
 */
export function contentToText(content: Content): string {
  if (isJSONContent(content)) {
    return stringify(content.json, null, 2) ?? ''
  }
  return content.text ?? ''
}

/**
 * Compare two contents semantically rather than textually: key order and
 * whitespace are ignored, and large numbers keep their precision.
 *
 * Returns `undefined` when either side is not valid JSON, letting callers
 * distinguish "invalid" from "different".
 */
export function isSameContent(a: Content, b: Content): boolean | undefined {
  try {
    const jsonA = toJSONContent(a, LosslessJSONParser).json
    const jsonB = toJSONContent(b, LosslessJSONParser).json
    return canonicalize(jsonA) === canonicalize(jsonB)
  } catch {
    return undefined
  }
}

/**
 * Stable stringification with object keys sorted, so key order is ignored.
 *
 * Values are tagged by type so that different types can never collide (e.g.
 * `null` vs the string `"null"`, or `1` vs `"1"`). Numbers are compared by
 * their textual form, which keeps `LosslessNumber` precision intact and makes
 * a parsed `LosslessNumber` compare equal to an equivalent plain number.
 */
function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'

  if (typeof value === 'number' || typeof value === 'bigint') return `n:${value.toString()}`
  if (typeof value === 'boolean') return `b:${value}`
  if (typeof value === 'string') return `s:${JSON.stringify(value)}`

  if (isLosslessNumber(value)) return `n:${String(value)}`

  if (Array.isArray(value)) {
    return `[${(value as unknown[]).map(canonicalize).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([keyA], [keyB]) => (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
    .map(([key, val]) => `${JSON.stringify(key)}:${canonicalize(val)}`)
  return `{${entries.join(',')}}`
}

/**
 * `LosslessNumber` is an object wrapper, so it must be detected before the
 * generic object branch or it would canonicalize to an empty object.
 */
function isLosslessNumber(value: object): boolean {
  return (
    'isLosslessNumber' in value &&
    Boolean((value as { isLosslessNumber?: boolean }).isLosslessNumber)
  )
}

/** Debounce that also exposes `flush` so pending writes can be forced out. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
): {
  call: (...args: Args) => void
  flush: () => void
  cancel: () => void
  /** True while a call is waiting to fire. */
  readonly pending: boolean
} {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Args | undefined

  return {
    call(...args: Args) {
      pending = args
      clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        const args = pending
        pending = undefined
        if (args) fn(...args)
      }, delay)
    },
    flush() {
      clearTimeout(timer)
      timer = undefined
      const args = pending
      pending = undefined
      if (args) fn(...args)
    },
    cancel() {
      clearTimeout(timer)
      timer = undefined
      pending = undefined
    },
    get pending() {
      return pending !== undefined
    },
  }
}
