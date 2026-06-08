import { describe, it, expect } from 'vitest'
import {
  isChunkLoadError,
  shouldAutoReload,
  markReloaded,
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
} from '../chunk-error'

describe('isChunkLoadError', () => {
  it('detects errors named ChunkLoadError regardless of message', () => {
    const e = new Error('anything')
    e.name = 'ChunkLoadError'
    expect(isChunkLoadError(e)).toBe(true)
  })

  it('detects "Loading chunk <id> failed" messages', () => {
    expect(isChunkLoadError(new Error('Loading chunk 4827 failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading chunk app-layout failed'))).toBe(true)
  })

  it('detects dynamic import failure messages', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /x.js'))).toBe(true)
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new Error('importing a module script failed.'))).toBe(true)
  })

  it('is case-insensitive on the message', () => {
    expect(isChunkLoadError(new Error('LOADING CHUNK 12 FAILED'))).toBe(true)
  })

  it('returns false for unrelated runtime errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false)
  })

  it('returns false for non-error / nullish values', () => {
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError('Loading chunk 1 failed')).toBe(false)
    expect(isChunkLoadError({})).toBe(false)
  })
})

// Minimal in-memory Storage stand-in for the guard tests.
function makeStorage(initial?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
  } as Storage
}

describe('shouldAutoReload guard', () => {
  it('allows reload when no record exists', () => {
    expect(shouldAutoReload(makeStorage(), 1_000_000)).toBe(true)
  })

  it('suppresses reload within the window (tight-loop guard)', () => {
    const now = 1_000_000
    const storage = makeStorage({ [CHUNK_RELOAD_KEY]: String(now) })
    expect(shouldAutoReload(storage, now + 5_000)).toBe(false)
    expect(shouldAutoReload(storage, now + CHUNK_RELOAD_WINDOW_MS)).toBe(false)
  })

  it('re-arms after the window elapses (later deploy can auto-recover)', () => {
    const now = 1_000_000
    const storage = makeStorage({ [CHUNK_RELOAD_KEY]: String(now) })
    expect(shouldAutoReload(storage, now + CHUNK_RELOAD_WINDOW_MS + 1)).toBe(true)
  })

  it('allows reload when the stored value is not a finite number', () => {
    expect(shouldAutoReload(makeStorage({ [CHUNK_RELOAD_KEY]: 'garbage' }), 5)).toBe(true)
  })

  it('markReloaded then shouldAutoReload round-trips correctly', () => {
    const storage = makeStorage()
    const now = 2_000_000
    markReloaded(storage, now)
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe(String(now))
    expect(shouldAutoReload(storage, now + 1_000)).toBe(false)
    expect(shouldAutoReload(storage, now + CHUNK_RELOAD_WINDOW_MS + 1)).toBe(true)
  })
})
