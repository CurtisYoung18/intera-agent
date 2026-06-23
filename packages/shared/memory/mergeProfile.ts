// Shared UserProfile merge utilities — used by agent loop + Console compact route.
// Structured against the contract in ./contract.ts (PROFILE_SECTIONS, ProfileSections).

import {
  PROFILE_SECTIONS,
  type ProfileSection,
  type ProfileSections,
  emptyProfileSections,
  sectionHeader,
} from './contract'

// Cross-chat UserProfile is long-lived context. Keep it free of runtime
// internals and one-off case artifacts; those belong in chat/case memory.
const NOISE_PATTERNS = [
  /\[(?:assistant\s+)?tool_use\b/i,
  /\[(?:user\s+)?tool_result\b/i,
  /\btool_use_id\b/i,
  /\bproviderContent\b/i,
  /\bcaseId\b/i,
  /\bcase_type\b/i,
  /\brunId\b/i,
  /\binputEpoch\b/i,
  /\bcurrentStepId\b/i,
  /\bprocedureRun\b/i,
  /\b(?:kb_search|start_procedure|create_human_task|ask_user_questions|read_chat_memory|read_user_profile|finalize_procedure|remember)\b/i,
  /\bautomated_tools\b/i,
  /\b(?:hook|trace|debug|internal note|system note)\b/i,
  /\b(?:screenshot|receipt|transaction id|task id|queue:)\b/i,
  /\b(?:no prior sessions available|no stable identity|memory reason)\b/i,
  /^\s*[{}[\]]+\s*$/,
]

const KEY_ALIASES: Record<string, string> = {
  memberid: 'member_id',
  member_id: 'member_id',
  playerid: 'member_id',
  player_id: 'member_id',
  user_id: 'user_id',
  username: 'username',
  name: 'name',
  email: 'email',
  phone: 'phone',
  mobile: 'phone',
  language: 'preferred_language',
  reply_language: 'preferred_language',
  preferred_language: 'preferred_language',
  contact_preference: 'contact_preference',
  preferred_contact: 'contact_preference',
  support_preference: 'support_preference',
  vip_level: 'vip_level',
  vip_status: 'vip_status',
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function normalizeItem(item: string): string {
  return item
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
}

function containsJsonLikePayload(item: string): boolean {
  const open = (item.match(/[{\[]/g) ?? []).length
  const close = (item.match(/[}\]]/g) ?? []).length
  return open + close >= 4
}

function sanitizeProfileItem(item: string): string | null {
  const text = normalizeItem(item)
  if (!text) return null
  if (text.length > 500) return null
  if (containsJsonLikePayload(text)) return null
  if (NOISE_PATTERNS.some((pattern) => pattern.test(text))) return null
  return text
}

function normalizedDedupKey(item: string): string {
  return item.toLowerCase().replace(/\s+/g, ' ').trim()
}

function profileFieldKey(item: string): string | null {
  const match = item.match(/^\s*([^:：=-]{1,48})\s*[:：=-]\s*(.+)$/)
  if (!match) return null
  const rawKey = match[1]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return KEY_ALIASES[rawKey] ?? null
}

function mergeStableSectionItems(existingItems: string[], incomingItems: string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const fieldIndex = new Map<string, number>()

  const add = (item: string, replaceExistingField: boolean) => {
    const dedupKey = normalizedDedupKey(item)
    if (seen.has(dedupKey)) return

    const fieldKey = profileFieldKey(item)
    if (replaceExistingField && fieldKey && fieldIndex.has(fieldKey)) {
      const index = fieldIndex.get(fieldKey)!
      seen.delete(normalizedDedupKey(result[index]))
      result[index] = item
      seen.add(dedupKey)
      return
    }

    result.push(item)
    seen.add(dedupKey)
    if (fieldKey && !fieldIndex.has(fieldKey)) {
      fieldIndex.set(fieldKey, result.length - 1)
    }
  }

  for (const item of existingItems) add(item, false)
  for (const item of incomingItems) add(item, true)
  return result
}

function mergeAppendDedup(items: string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const key = normalizedDedupKey(item)
    if (seen.has(key)) continue
    result.push(item)
    seen.add(key)
  }
  return result
}

/**
 * Parse Markdown into structured ProfileSections.
 * Splits by `## <Section>` headers matching PROFILE_SECTIONS from the contract.
 * Within each section, extracts bullet-point lines (`- item` or `* item`).
 *
 * If the Markdown has no recognised section headers, the entire body is treated
 * as Identity (backward-compat with old-format summaries).
 */
function parseProfile(markdown: string): ProfileSections {
  const sections = emptyProfileSections()
  if (!markdown) return sections

  const headerRe = /^## (.+)$/
  let current: ProfileSection | null = null

  for (const line of markdown.split('\n')) {
    const hdr = line.match(headerRe)
    if (hdr) {
      const text = hdr[1].trim()
      const matched = PROFILE_SECTIONS.find((s) => s.toLowerCase() === text.toLowerCase())
      if (matched) {
        current = matched
        continue
      }
      // Unknown header — stop assigning to a section
      current = null
      continue
    }

    if (current) {
      const bullet = line.match(/^\s*[-*]\s+(.+)/)
      if (bullet) {
        const item = sanitizeProfileItem(bullet[1])
        if (item) sections[current].push(item)
      }
    }
  }

  // Backward compat: if NO sections were populated and we have content,
  // treat the whole body as Identity.
  const totalItems = Object.values(sections).reduce((s, a) => s + a.length, 0)
  if (totalItems === 0 && markdown.trim()) {
    // Split into lines and take non-empty ones as Identity items.
    // Drop obvious boilerplate like "# User Profile".
    const lines = markdown
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^#+\s/.test(l) && !/^[-*]\s/.test(l))
      .map((l) => sanitizeProfileItem(l))
      .filter((l): l is string => !!l)
    if (lines.length > 0) {
      sections.Identity = lines.slice(0, 20) // cap at 20 lines for raw summaries
    }
  }

  return sections
}

// ---------------------------------------------------------------------------
// Core merge logic
// ---------------------------------------------------------------------------

/**
 * Merge two ProfileSections according to the contract rules:
 * - Identity, Contact, Preferences: dedup (new items added, no duplicates)
 * - Activity: replace (new Activity replaces old; old Activity rolls to History)
 * - History: append (old History + superseded Activity + new History, deduped)
 */
function mergeProfileSections(
  existing: ProfileSections,
  incoming: ProfileSections,
): ProfileSections {
  const result = emptyProfileSections()

  // Identity, Contact, Preferences — dedup merge
  for (const sec of ['Identity', 'Contact', 'Preferences'] as ProfileSection[]) {
    result[sec] = mergeStableSectionItems(existing[sec], incoming[sec])
  }

  // Activity — replace (old rolls to History)
  result.Activity = mergeAppendDedup(incoming.Activity)

  // History — append
  // 1. Existing History
  result.History.push(...existing.History)

  // 2. Superseded (old) Activity rolls into History
  result.History.push(...existing.Activity)

  // 3. Incoming History
  result.History.push(...incoming.History)
  result.History = mergeAppendDedup(result.History)

  return result
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/**
 * Truncate sections to stay within a line budget.
 * Drops from History first, then Preferences, then Activity.
 * Never drops from Identity or Contact.
 */
function truncateProfile(sections: ProfileSections, maxLines: number): ProfileSections {
  const totalLines = (s: ProfileSections): number =>
    Object.values(s).reduce((sum, arr) => sum + arr.length, 0)

  if (totalLines(sections) <= maxLines) return sections

  // Clone so we can mutate
  const result: ProfileSections = {
    Identity: [...sections.Identity],
    Contact: [...sections.Contact],
    Preferences: [...sections.Preferences],
    Activity: [...sections.Activity],
    History: [...sections.History],
  }

  // Drop order: History (oldest first), then Preferences (oldest first),
  // then Activity (oldest first)
  const dropOrder: ProfileSection[] = ['History', 'Preferences', 'Activity']

  for (const sec of dropOrder) {
    while (totalLines(result) > maxLines && result[sec].length > 0) {
      result[sec].shift() // drop oldest (first in array)
    }
    if (totalLines(result) <= maxLines) break
  }

  return result
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render ProfileSections back to Markdown in contract order.
 * Each section: `## <Section>\n- item1\n- item2\n...`
 */
function renderProfile(sections: ProfileSections): string {
  const parts: string[] = ['# User Profile']

  for (const sec of PROFILE_SECTIONS) {
    const items = sections[sec]
    if (items.length === 0) continue
    parts.push('')
    parts.push(sectionHeader(sec))
    for (const item of items) {
      parts.push(`- ${item}`)
    }
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge a new Markdown summary into the existing user profile.
 *
 * Returns both the rendered Markdown string (`profile`) and the structured
 * JSON sections (`sections`) so callers can dual-write to the `UserProfile` row.
 *
 * @param existingMarkdown  Current profile Markdown from the DB (or empty string)
 * @param newMarkdown       Incoming summary Markdown from the LLM
 * @param maxTokens         Optional token budget for truncation (0 or undefined = no truncation)
 */
export function mergeProfile(
  existingMarkdown: string,
  newMarkdown: string,
  maxTokens?: number,
): { profile: string; sections: string } {
  const existing = parseProfile(existingMarkdown)
  const incoming = parseProfile(newMarkdown)

  let merged = mergeProfileSections(existing, incoming)

  if (maxTokens && maxTokens > 0) {
    // Rough heuristic: each bullet line is ~4 tokens (chars/4 ≈ tokens)
    // Use a floor of 10 lines so Identity/Contact always have room.
    const maxLines = Math.max(10, Math.floor(maxTokens / 4))
    merged = truncateProfile(merged, maxLines)
  }

  const rendered = renderProfile(merged)

  return {
    profile: rendered,
    sections: JSON.stringify(merged),
  }
}
