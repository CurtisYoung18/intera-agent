// Stable identity key for UserProfile accumulation.
// Prevents anonymous sessions and UUID-only ids from sharing the same profile row.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INTERNAL_CUID_RE = /^c[a-z0-9]{24,}$/
const VERIFIED_MEMBER_ID_RE = /^[A-Z][A-Z0-9_-]{5,}$/

export function isOpaqueInternalUserId(userId?: string | null): boolean {
  const u = (userId ?? '').trim()
  return UUID_RE.test(u) || INTERNAL_CUID_RE.test(u) || u.startsWith('pg_')
}

export function isVerifiedMemberId(userId?: string | null): boolean {
  const u = (userId ?? '').trim()
  return VERIFIED_MEMBER_ID_RE.test(u)
}

/**
 * Returns a stable key for UserProfile lookup/write, or null if no stable identity exists.
 *
 * Rules:
 * - Real user IDs (non-null, non-"anonymous", non-opaque internal ids) → `user:<id>`
 * - Anonymous / opaque internal ids → fallback to `chat:<chatId>` if available
 * - Neither stable → null (do not read/write UserProfile)
 */
export function profileKey(userId?: string, chatId?: string | null): string | null {
  const u = (userId ?? '').trim()
  const isAnon = !u || u === 'anonymous'
  const isOpaque = isOpaqueInternalUserId(u)

  if (!isAnon && !isOpaque) return `user:${u}`
  if (chatId && chatId.trim()) return `chat:${chatId.trim()}`
  return null
}
