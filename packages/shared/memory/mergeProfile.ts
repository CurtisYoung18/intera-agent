// Shared UserProfile merge utilities — used by agent loop + Console compact route.

/**
 * Parse an existing profile into sections for intelligent merging.
 * Returns the sections and any unrecognized trailing content.
 */
function parseSections(profile: string): {
  header: string
  identity: string
  contact: string
  preferences: string
  activity: string
  history: string
  tail: string
} {
  const sections = {
    header: '',
    identity: '',
    contact: '',
    preferences: '',
    activity: '',
    history: '',
    tail: '',
  }

  let current: keyof typeof sections = 'tail'
  const lines = profile.split('\n')

  for (const line of lines) {
    if (/^# User Profile/i.test(line)) { sections.header = line; current = 'tail'; continue }
    if (/^## Identity/i.test(line)) { current = 'identity'; sections.identity = line; continue }
    if (/^## Contact/i.test(line)) { current = 'contact'; sections.contact = line; continue }
    if (/^## Preference/i.test(line)) { current = 'preferences'; sections.preferences = line; continue }
    if (/^## (Recent )?Activity/i.test(line)) { current = 'activity'; sections.activity = line; continue }
    if (/^## (History|Past Cases)/i.test(line)) { current = 'history'; sections.history = line; continue }

    // If we haven't hit any section yet and it's not the header, it's header content
    if (current === 'tail' && !sections.header) {
      sections.header = line
      continue
    }

    const existing = sections[current]
    sections[current] = existing ? `${existing}\n${line}` : line
  }

  return sections
}

/** Build a fresh portrait from sections. Top = identity/contact/preferences, bottom = history. */
function buildPortrait(sections: ReturnType<typeof parseSections>): string {
  const parts: string[] = []
  const header = sections.header || '# User Profile'
  parts.push(header)

  const pushSection = (title: string, content: string) => {
    const body = content.replace(new RegExp(`^## ${title}\n?`, 'i'), '').trim()
    if (body) parts.push(`\n## ${title}\n${body}`)
  }

  pushSection('Identity', sections.identity)
  pushSection('Contact', sections.contact)
  pushSection('Preferences', sections.preferences)
  pushSection('Activity', sections.activity)
  pushSection('History', sections.history)
  if (sections.tail.trim()) parts.push(sections.tail.trim())

  return parts.join('\n')
}

/** Extract structured facts from a compact summary and merge into the portrait.
 *  New facts update same-section content; absent sections are left as-is. */
function mergeIntoPortrait(
  oldProfile: string,
  summary: string,
): string {
  const sections = parseSections(oldProfile)

  // Extract structured fields from the summary
  const extractField = (pattern: RegExp): string => {
    const m = summary.match(pattern)
    return m ? m[1].trim() : ''
  }

  // Identity: merge new facts, don't lose old ones
  const newIdentity = extractField(/(?:Identity|Member)[:\s]*([^\n]+(?:\n\s*-[^\n]+)*)/i)
  if (newIdentity) {
    const existingIdentity = sections.identity.replace(/^## Identity\n?/i, '').trim()
    const merged = existingIdentity
      ? `${existingIdentity}\n${newIdentity}`
      : newIdentity
    sections.identity = `## Identity\n${merged}`
  }

  // Contact: keep existing unless new info appears
  const newContact = extractField(/(?:Contact|Phone|Email)[:\s]*([^\n]+(?:\n\s*-[^\n]+)*)/i)
  if (newContact) {
    const existingContact = sections.contact.replace(/^## Contact\n?/i, '').trim()
    sections.contact = `## Contact\n${existingContact ? `${existingContact}\n${newContact}` : newContact}`
  }

  // Preferences: accumulate over time
  const newPrefs = extractField(/(?:Preference|Behavior|通常|偏好)[:\s]*([^\n]+(?:\n\s*-[^\n]+)*)/i)
  if (newPrefs) {
    const existingPrefs = sections.preferences.replace(/^## Preferences?\n?/i, '').trim()
    sections.preferences = `## Preferences\n${existingPrefs ? `${existingPrefs}\n${newPrefs}` : newPrefs}`
  }

  // Activity: always replace with latest
  const newActivity = extractField(/(?:Activity|Recent|Case State|Current)[:\s]*([^\n]+(?:\n\s*-[^\n]+)*)/i)
  if (newActivity) {
    sections.activity = `## Activity\n${newActivity}`
  } else if (!sections.activity.trim()) {
    // Use the full summary as activity if no structured field found
    sections.activity = `## Activity\n${summary.slice(0, 500)}`
  }

  // History: accumulate compressed old activity
  const oldActivity = sections.activity.replace(/^## Activity\n?/i, '').trim()
  if (oldActivity && !sections.history.includes(oldActivity.slice(0, 50))) {
    const existingHistory = sections.history.replace(/^## History\n?/i, '').trim()
    const now = new Date().toISOString().slice(0, 10)
    const entry = `- ${now}: ${oldActivity.slice(0, 300)}`
    sections.history = `## History\n${existingHistory ? `${existingHistory}\n${entry}` : entry}`
  }

  return buildPortrait(sections)
}

/**
 * Merge a new compact summary into the existing UserProfile.
 * Produces a structured user portrait — NOT a chronological log.
 * Identity/Contact/Preferences stay at top; older activity rolls into History.
 */
export function mergeProfile(oldProfile: string, newSummary: string, maxTokens: number): string {
  // Strip noisy tags from compaction output
  let cleaned = newSummary
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?summary>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!cleaned) return oldProfile

  const portrait = oldProfile
    ? mergeIntoPortrait(oldProfile, cleaned)
    : `# User Profile\n\n## Identity\n${cleaned.slice(0, 400)}\n\n## Activity\n${cleaned.slice(0, 800)}`

  // Token budget enforcement
  if (maxTokens <= 0) return portrait
  const estimatedTokens = portrait.length / 4
  if (estimatedTokens <= maxTokens) return portrait

  // Truncate History first, then older sections
  const paragraphs = portrait.split(/\n\n+/)
  const kept: string[] = []
  let chars = 0
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i]
    if (chars + p.length > maxTokens * 4) break
    kept.unshift(p)
    chars += p.length + 2
  }
  return kept.join('\n\n').trim() || portrait
}
