// Shared logic for the console's error boundaries (app/error.tsx + app/global-error.tsx).
//
// Problem: on deploy, hashed JS chunk filenames change. A client mid-session that
// requests a now-removed chunk gets a 400/404 ChunkLoadError -> white screen with no
// recovery until a manual refresh. We detect that failure and auto-reload once.

const CHUNK_ERROR_MESSAGE =
  /Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i

// sessionStorage key shared by both boundaries so the one-reload guard is global,
// not per-boundary. Stores a millisecond timestamp (Date.now()) of the last auto-reload.
export const CHUNK_RELOAD_KEY = '__intera_chunk_reload'

// How long an auto-reload "counts" before we re-arm. Suppresses a tight reload loop
// (if the reload itself fails the same way) but lets a later, unrelated deploy still
// auto-recover.
export const CHUNK_RELOAD_WINDOW_MS = 10_000

/** True when `error` looks like a deploy-rotated chunk load failure. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: unknown; message?: unknown }
  if (e.name === 'ChunkLoadError') return true
  const message = typeof e.message === 'string' ? e.message : ''
  return CHUNK_ERROR_MESSAGE.test(message)
}

/**
 * True when we should auto-reload now: we're not inside the recently-reloaded window.
 * Reads sessionStorage; safe to call in the browser only. `now` is injectable for tests.
 */
export function shouldAutoReload(storage: Storage, now: number = Date.now()): boolean {
  let raw: string | null = null
  try {
    raw = storage.getItem(CHUNK_RELOAD_KEY)
  } catch {
    // sessionStorage can throw (privacy mode / disabled) — treat as "no record".
    return true
  }
  if (!raw) return true
  const ts = Number(raw)
  if (!Number.isFinite(ts)) return true
  return now - ts > CHUNK_RELOAD_WINDOW_MS
}

/** Record that we just auto-reloaded, so an immediate repeat is suppressed. */
export function markReloaded(storage: Storage, now: number = Date.now()): void {
  try {
    storage.setItem(CHUNK_RELOAD_KEY, String(now))
  } catch {
    // ignore — worst case we may double-reload, still bounded by the reload itself.
  }
}
