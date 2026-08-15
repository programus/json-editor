import { parse } from 'lossless-json'
import { describe, expect, it, vi } from 'vitest'
import {
  cloneContent,
  contentToText,
  createDefaultContent,
  debounce,
  isSameContent,
} from '../src/lib/utils.svelte'

describe('createDefaultContent', () => {
  it('returns valid, empty JSON text', () => {
    expect(createDefaultContent()).toEqual({ text: '{}' })
  })

  it('returns a fresh object each call so panes cannot alias each other', () => {
    const a = createDefaultContent()
    const b = createDefaultContent()
    expect(a).not.toBe(b)
  })
})

describe('cloneContent', () => {
  it('copies the wrapper of text content', () => {
    const source = { text: '{"a":1}' }
    const copy = cloneContent(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect('json' in copy).toBe(false)
  })

  it('copies the wrapper of json content and shares the immutable payload', () => {
    const source = { json: { a: 1 } }
    const copy = cloneContent(source) as { json: unknown }
    expect(copy).not.toBe(source)
    // The inner value is treated as immutable, so sharing it is intentional.
    expect(copy.json).toBe(source.json)
    expect('text' in copy).toBe(false)
  })

  it('isolates mutations of the wrapper', () => {
    const source = { text: 'original' }
    const copy = cloneContent(source) as { text: string }
    copy.text = 'changed'
    expect(source.text).toBe('original')
  })
})

describe('contentToText', () => {
  it('stores text content verbatim so user formatting survives', () => {
    const handFormatted = '{\n    "a":   1,\n    "b": [1,2,3]\n}'
    expect(contentToText({ text: handFormatted })).toBe(handFormatted)
  })

  it('serializes json content with 2-space indentation', () => {
    expect(contentToText({ json: { a: 1 } })).toBe('{\n  "a": 1\n}')
  })

  it('preserves large-number precision via lossless-json', () => {
    const json = parse('{"n":12345678901234567890}')
    expect(contentToText({ json })).toBe('{\n  "n": 12345678901234567890\n}')
  })

  it('returns an empty string for empty text', () => {
    expect(contentToText({ text: '' })).toBe('')
  })
})

describe('isSameContent', () => {
  it('ignores key order', () => {
    expect(isSameContent({ text: '{"a":1,"b":2}' }, { text: '{"b":2,"a":1}' })).toBe(true)
  })

  it('ignores whitespace and indentation', () => {
    expect(isSameContent({ text: '{"a":1}' }, { text: '{\n  "a": 1\n}' })).toBe(true)
  })

  it('ignores key order in nested objects', () => {
    expect(isSameContent({ text: '{"x":{"p":1,"q":2}}' }, { text: '{"x":{"q":2,"p":1}}' })).toBe(
      true,
    )
  })

  it('detects genuinely different values', () => {
    expect(isSameContent({ text: '{"a":1}' }, { text: '{"a":2}' })).toBe(false)
  })

  it('treats array order as significant', () => {
    expect(isSameContent({ text: '[1,2]' }, { text: '[2,1]' })).toBe(false)
  })

  it('detects a missing key', () => {
    expect(isSameContent({ text: '{"a":1,"b":2}' }, { text: '{"a":1}' })).toBe(false)
  })

  it('returns undefined when either side is invalid JSON', () => {
    expect(isSameContent({ text: '{oops' }, { text: '{"a":1}' })).toBeUndefined()
    expect(isSameContent({ text: '{"a":1}' }, { text: 'nope' })).toBeUndefined()
  })

  it('compares json content against equivalent text content', () => {
    expect(isSameContent({ json: { a: 1 } }, { text: '{"a":1}' })).toBe(true)
  })

  it('preserves big-number precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(
      isSameContent({ text: '{"n":12345678901234567890}' }, { text: '{"n":12345678901234567890}' }),
    ).toBe(true)
    // Differs only in the final digit, which native JSON.parse would collapse.
    expect(
      isSameContent({ text: '{"n":12345678901234567890}' }, { text: '{"n":12345678901234567891}' }),
    ).toBe(false)
  })

  // These guard the type-tagging fix: without it, distinct types collided.
  it.each([
    ['null vs "null"', '{"a":null}', '{"a":"null"}'],
    ['number vs string', '{"a":1}', '{"a":"1"}'],
    ['boolean vs string', '{"a":true}', '{"a":"true"}'],
    ['number vs boolean', '{"a":1}', '{"a":true}'],
    ['empty object vs empty array', '{}', '[]'],
  ])('keeps %s distinct', (_label, left, right) => {
    expect(isSameContent({ text: left }, { text: right })).toBe(false)
  })

  it('treats differing numeric notation as different (lossless semantics)', () => {
    expect(isSameContent({ text: '{"a":1.0}' }, { text: '{"a":1}' })).toBe(false)
  })

  it('handles deeply nested equal structures', () => {
    const doc = '{"a":{"b":{"c":[1,{"d":2}]}}}'
    expect(isSameContent({ text: doc }, { text: doc })).toBe(true)
  })
})

describe('debounce', () => {
  it('coalesces rapid calls into a single invocation', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 100)

    d.call(1)
    d.call(2)
    d.call(3)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
    vi.useRealTimers()
  })

  it('flush invokes immediately with the latest arguments', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 100)

    d.call('a')
    d.call('b')
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')

    // The pending timer must not fire again after a flush.
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('flush is a no-op when nothing is pending', () => {
    const fn = vi.fn()
    debounce(fn, 100).flush()
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel discards pending calls', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 100)

    d.call(1)
    d.cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()

    d.flush()
    expect(fn).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('allows further calls after a flush', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 100)

    d.call(1)
    d.flush()
    d.call(2)
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(2)
    vi.useRealTimers()
  })
})
