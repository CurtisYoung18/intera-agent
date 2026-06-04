// Shared UserProfile merge utilities — used by agent loop + Console compact route.
// Structured against the contract in ./contract.ts (PROFILE_SECTIONS, ProfileSections).

import {
  PROFILE_SECTIONS,
  type ProfileSection,
  type ProfileSections,
  emptyProfileSections,
  sectionHeader,
} from './contract'

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

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
        sections[current].push(bullet[1].trim())
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
    const seen = new Set(existing[sec])
    result[sec] = [...existing[sec]]
    for (const item of incoming[sec]) {
      if (!seen.has(item)) {
        result[sec].push(item)
        seen.add(item)
      }
    }
  }

  // Activity — replace (old rolls to History)
  result.Activity = [...incoming.Activity]

  // History — append
  const historySet = new Set<string>()

  // 1. Existing History
  for (const item of existing.History) {
    if (!historySet.has(item)) {
      result.History.push(item)
      historySet.add(item)
    }
  }

  // 2. Superseded (old) Activity rolls into History
  for (const item of existing.Activity) {
    if (!historySet.has(item)) {
      result.History.push(item)
      historySet.add(item)
    }
  }

  // 3. Incoming History
  for (const item of incoming.History) {
    if (!historySet.has(item)) {
      result.History.push(item)
      historySet.add(item)
    }
  }

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
