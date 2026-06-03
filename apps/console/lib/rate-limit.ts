// In-memory rate limiter for single-server deployments.
// Resets on restart — sufficient for internal/testing use.
// For multi-server prod, replace with Redis-backed implementation.

interface Window {
  count: number
  resetAt: number
}

const store = new Map<string, Window>()

// Clean up expired entries every 5 minutes to prevent memory leaks.
const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, w] of store) {
    if (now > w.resetAt) store.delete(key)
  }
}

interface RateLimitOptions {
  /** Unique key for this rate limit (e.g. `login:${ip}`). */
  key: string
  /** Max requests allowed within the window. */
  max: number
  /** Window duration in seconds. */
  windowSec: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export function checkRateLimit({ key, max, windowSec }: RateLimitOptions): RateLimitResult {
  cleanup()

  const now = Date.now()
  const existing = store.get(key)

  if (!existing || now > existing.resetAt) {
    const resetAt = now + windowSec * 1000
    store.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: max - 1, resetAt }
  }

  existing.count++
  if (existing.count > max) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt }
  }

  return { allowed: true, remaining: max - existing.count, resetAt: existing.resetAt }
}

/** Extract a stable client IP from a NextRequest, accounting for proxies. */
export function clientIp(req: { headers: Headers }): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '127.0.0.1'
  )
}
