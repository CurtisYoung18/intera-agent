/** Bound guest draft length before invoking composer continuation (characters). */
export function clampComposerMinDraftChars(raw: unknown, fallback = 4): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(120, Math.max(1, Math.floor(n)))
}
