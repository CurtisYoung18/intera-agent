// Stable identity key for UserProfile accumulation.
// Prevents anonymous sessions and UUID-only ids from sharing the same profile row.

/**
 * Returns a stable key for UserProfile lookup/write, or null if no stable identity exists.
 *
 * Rules:
 * - Real user IDs (non-null, non-"anonymous", non-UUID) → `user:<id>`
 * - Anonymous / UUID users → fallback to `chat:<chatId>` if available
 * - Neither stable → null (do not read/write UserProfile)
 */
export function profileKey(userId?: string, chatId?: string | null): string | null {
  const u = (userId ?? '').trim()
  const isAnon = !u || u === 'anonymous'
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u)

  if (!isAnon && !isUuid) return `user:${u}`
  if (chatId && chatId.trim()) return `chat:${chatId.trim()}`
  return null
}
