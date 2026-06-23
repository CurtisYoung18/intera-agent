import { describe, it, expect } from 'vitest'
import { mergeProfile } from '../mergeProfile'
import {
  PROFILE_SECTIONS,
  emptyProfileSections,
  sectionHeader,
} from '../contract'
import type { ProfileSections } from '../contract'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build Markdown from sections for use as existing/new input. */
function markdown(sections: Partial<ProfileSections>): string {
  const full = emptyProfileSections()
  for (const [k, v] of Object.entries(sections)) {
    if (v) (full as Record<string, string[]>)[k] = v
  }
  const parts: string[] = ['# User Profile']
  for (const sec of PROFILE_SECTIONS) {
    const items = full[sec]
    if (items.length === 0) continue
    parts.push('')
    parts.push(sectionHeader(sec))
    for (const item of items) {
      parts.push(`- ${item}`)
    }
  }
  return parts.join('\n')
}

/** Parse the sections JSON string back to an object. */
function parseSections(sectionsStr: string): ProfileSections {
  return JSON.parse(sectionsStr) as ProfileSections
}

/** Count total items across all sections. */
function totalItems(sections: ProfileSections): number {
  return Object.values(sections).reduce((s, a) => s + a.length, 0)
}

// ---------------------------------------------------------------------------
// Parsing contract headers
// ---------------------------------------------------------------------------

describe('mergeProfile — parsing contract headers', () => {
  it('parses ## Identity, ## Contact, ## Preferences, ## Activity, ## History', () => {
    const profile = markdown({
      Identity: ['name: Alice'],
      Contact: ['email: alice@example.com'],
      Preferences: ['language: English'],
      Activity: ['last login: 2026-06-01'],
      History: ['previous chat about billing'],
    })

    const result = mergeProfile('', profile)
    const sections = parseSections(result.sections)

    expect(sections.Identity).toEqual(['name: Alice'])
    expect(sections.Contact).toEqual(['email: alice@example.com'])
    expect(sections.Preferences).toEqual(['language: English'])
    expect(sections.Activity).toEqual(['last login: 2026-06-01'])
    expect(sections.History).toEqual(['previous chat about billing'])
  })

  it('handles mixed-case headers (## IDENTITY, ## contact)', () => {
    const raw = [
      '# User Profile',
      '',
      '## IDENTITY',
      '- user: Bob',
      '',
      '## contact',
      '- phone: 555-0100',
    ].join('\n')

    const result = mergeProfile('', raw)
    const sections = parseSections(result.sections)

    expect(sections.Identity).toEqual(['user: Bob'])
    expect(sections.Contact).toEqual(['phone: 555-0100'])
  })

  it('ignores unknown ## headers', () => {
    const raw = [
      '# User Profile',
      '',
      '## Identity',
      '- user: Carol',
      '',
      '## Unknown Section',
      '- should be ignored',
      '',
      '## Activity',
      '- last seen: today',
    ].join('\n')

    const result = mergeProfile('', raw)
    const sections = parseSections(result.sections)

    expect(sections.Identity).toEqual(['user: Carol'])
    expect(sections.Activity).toEqual(['last seen: today'])
    // Unknown header content should not land anywhere
    expect(totalItems(sections)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe('mergeProfile — deduplication', () => {
  it('deduplicates Identity lines (same line added twice => one copy)', () => {
    const existing = markdown({ Identity: ['name: Alice'] })
    const incoming = markdown({ Identity: ['name: Alice'] })

    const result = mergeProfile(existing, incoming)
    const sections = parseSections(result.sections)

    expect(sections.Identity).toEqual(['name: Alice'])
  })

  it('preserves unique Identity lines from both existing and incoming', () => {
    const existing = markdown({ Identity: ['name: Alice'] })
    const incoming = markdown({ Identity: ['age: 30'] })

    const result = mergeProfile(existing, incoming)
    const sections = parseSections(result.sections)

    expect(sections.Identity).toEqual(['name: Alice', 'age: 30'])
  })

  it('deduplicates Contact lines', () => {
    const existing = markdown({ Contact: ['email: a@b.com'] })
    const incoming = markdown({ Contact: ['email: a@b.com', 'phone: 555-0100'] })

    const result = mergeProfile(existing, incoming)
    const sections = parseSections(result.sections)

    expect(sections.Contact).toEqual(['email: a@b.com', 'phone: 555-0100'])
  })

  it('deduplicates Preferences lines', () => {
    const existing = markdown({ Preferences: ['theme: dark'] })
    const incoming = markdown({ Preferences: ['theme: dark', 'lang: en'] })

    const result = mergeProfile(existing, incoming)
    const sections = parseSections(result.sections)

    expect(sections.Preferences).toEqual(['theme: dark', 'lang: en'])
  })
})

// ---------------------------------------------------------------------------
// Sanitization and semantic updates
// ---------------------------------------------------------------------------

describe('mergeProfile — profile hygiene', () => {
  it('removes runtime internals from existing and incoming profile text', () => {
    const existing = [
      '# User Profile',
      '',
      '## Identity',
      '- member_id: JAYA1197202',
      '- [assistant tool_use id=toolu_1 name=kb_search_deposit input={"query":"deposit"}]',
      '- No prior sessions available',
      '',
      '## Activity',
      '- automated_tools: kb_search_deposit, start_procedure',
      '- Customer asked about deposit delay.',
    ].join('\n')
    const incoming = [
      '# User Profile',
      '',
      '## Activity',
      '- [user tool_result tool_use_id=toolu_1 content={"ok":true}]',
      '- receipt filename: deposit-slip.png',
      '- Customer still prefers Romanized Nepali replies.',
    ].join('\n')

    const result = mergeProfile(existing, incoming)
    const sections = parseSections(result.sections)

    expect(result.profile).not.toMatch(/tool_use|tool_result|kb_search|start_procedure|No prior sessions|receipt/i)
    expect(sections.Identity).toEqual(['member_id: JAYA1197202'])
    expect(sections.Activity).toEqual(['Customer still prefers Romanized Nepali replies.'])
    expect(sections.History).toEqual(['Customer asked about deposit delay.'])
  })

  it('replaces stable keyed facts with the newest value instead of appending contradictions', () => {
    const existing = markdown({
      Identity: ['member_id: JAYA1111111'],
      Preferences: ['language: English'],
    })
    const incoming = markdown({
      Identity: ['Member ID: JAYA1197202'],
      Preferences: ['preferred language: Romanized Nepali'],
    })

    const result = mergeProfile(existing, incoming)
    const sections = parseSections(result.sections)

    expect(sections.Identity).toEqual(['Member ID: JAYA1197202'])
    expect(sections.Preferences).toEqual(['preferred language: Romanized Nepali'])
    expect(result.profile).not.toContain('JAYA1111111')
    expect(result.profile).not.toContain('language: English')
  })

  it('drops old-format raw summaries that only contain runtime artifacts', () => {
    const raw = [
      '# User Profile',
      '[assistant tool_use id=toolu_1 name=read_user_profile input={}]',
      '[user tool_result tool_use_id=toolu_1 content={"profile":"No prior sessions available"}]',
      'Task ID: cmqq123',
    ].join('\n')

    const result = mergeProfile('', raw)
    const sections = parseSections(result.sections)

    expect(result.profile).toBe('# User Profile')
    expect(totalItems(sections)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Activity rolls into History
// ---------------------------------------------------------------------------

describe('mergeProfile — Activity replacement rolls into History', () => {
  it('old Activity is moved to History when new Activity arrives', () => {
    const existing = markdown({
      Activity: ['issue: login problem', 'status: investigating'],
    })
    const incoming = markdown({
      Activity: ['issue: billing question'],
    })

    const result = mergeProfile(existing, incoming)
    const sections = parseSections(result.sections)

    expect(sections.Activity).toEqual(['issue: billing question'])
    expect(sections.History).toContain('issue: login problem')
    expect(sections.History).toContain('status: investigating')
  })

  it('existing History is preserved alongside rolled-off Activity', () => {
    const existing = markdown({
      Activity: ['issue: login problem'],
      History: ['previous: chat about refunds'],
    })
    const incoming = markdown({
      Activity: ['issue: new inquiry'],
    })

    const result = mergeProfile(existing, incoming)
    const sections = parseSections(result.sections)

    expect(sections.History).toContain('previous: chat about refunds')
    expect(sections.History).toContain('issue: login problem')
    expect(sections.Activity).toEqual(['issue: new inquiry'])
  })

  it('incoming History is appended alongside existing History and rolled Activity', () => {
    const existing = markdown({
      Activity: ['old activity'],
      History: ['old history'],
    })
    const incoming = markdown({
      Activity: ['new activity'],
      History: ['new history item'],
    })

    const result = mergeProfile(existing, incoming)
    const sections = parseSections(result.sections)

    expect(sections.History).toContain('old history')
    expect(sections.History).toContain('old activity')
    expect(sections.History).toContain('new history item')
    expect(sections.Activity).toEqual(['new activity'])
  })
})

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

describe('mergeProfile — truncation', () => {
  it('drops History first when over token budget', () => {
    // Build a profile with many History items and a small budget
    const existing = markdown({
      Identity: ['name: Alice'],
      Contact: ['email: a@b.com'],
      History: Array.from({ length: 20 }, (_, i) => `history item ${i + 1}`),
    })
    const incoming = markdown({
      Activity: ['new activity'],
    })

    // maxTokens=40 => maxLines=10 — should truncate 20 History items heavily
    const result = mergeProfile(existing, incoming, 40)
    const sections = parseSections(result.sections)

    // Identity and Contact must be preserved
    expect(sections.Identity).toEqual(['name: Alice'])
    expect(sections.Contact).toEqual(['email: a@b.com'])
    // Total items should be <= 10
    expect(totalItems(sections)).toBeLessThanOrEqual(10)
  })

  it('never drops Identity or Contact', () => {
    const existing = markdown({
      Identity: ['name: Alice', 'age: 30', 'city: NY'],
      Contact: ['email: a@b.com', 'phone: 555'],
      History: Array.from({ length: 30 }, (_, i) => `h${i}`),
    })
    const incoming = markdown({ Activity: ['new'] })

    // Extremely small budget
    const result = mergeProfile(existing, incoming, 20)
    const sections = parseSections(result.sections)

    expect(sections.Identity.length).toBeGreaterThan(0)
    expect(sections.Contact.length).toBeGreaterThan(0)
    // Identity + Contact together should have all 5 original items
    expect(sections.Identity.length + sections.Contact.length).toBe(5)
  })

  it('no truncation when maxTokens is 0 or undefined', () => {
    const existing = markdown({
      History: Array.from({ length: 50 }, (_, i) => `h${i}`),
    })
    const incoming = markdown({ Activity: ['new'] })

    const result0 = mergeProfile(existing, incoming, 0)
    const resultUndef = mergeProfile(existing, incoming)

    // Without a budget, nothing should be truncated
    const s0 = parseSections(result0.sections)
    const sU = parseSections(resultUndef.sections)

    expect(s0.History.length).toBeGreaterThan(30)
    expect(sU.History.length).toBeGreaterThan(30)
  })
})

// ---------------------------------------------------------------------------
// renderProfile output
// ---------------------------------------------------------------------------

describe('mergeProfile — rendered output', () => {
  it('emits headers in contract order', () => {
    const result = mergeProfile(
      '',
      markdown({
        Identity: ['name: Alice'],
        History: ['old chat'],
        Activity: ['current chat'],
        Contact: ['email: a@b.com'],
      }),
    )

    // Headers should appear in PROFILE_SECTIONS order: Identity, Contact, Preferences, Activity, History
    const lines = result.profile.split('\n')
    const headerLines = lines.filter((l) => l.startsWith('## '))
    const headerNames = headerLines.map((l) => l.replace('## ', ''))

    // Only sections with content appear
    expect(headerNames[0]).toBe('Identity')
    expect(headerNames[1]).toBe('Contact')
    expect(headerNames[2]).toBe('Activity')
    expect(headerNames[3]).toBe('History')
  })

  it('omits empty sections', () => {
    const result = mergeProfile(
      '',
      markdown({ Identity: ['name: Alice'] }),
    )

    const lines = result.profile.split('\n')
    const headerLines = lines.filter((l) => l.startsWith('## '))

    expect(headerLines).toHaveLength(1)
    expect(headerLines[0]).toBe('## Identity')
  })

  it('profile and sections are consistent', () => {
    const existing = markdown({
      Identity: ['name: Alice'],
      Activity: ['issue: login'],
    })
    const incoming = markdown({
      Activity: ['issue: billing'],
    })

    const result = mergeProfile(existing, incoming)
    const sections = parseSections(result.sections)

    // Re-parse the rendered profile and compare
    const reResult = mergeProfile('', result.profile)
    const reSections = parseSections(reResult.sections)

    expect(reSections.Identity).toEqual(sections.Identity)
    expect(reSections.Activity).toEqual(sections.Activity)
    expect(reSections.History).toEqual(sections.History)
  })
})

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe('mergeProfile — backward compat (old-format Markdown)', () => {
  it('handles raw summary without ## headers as Identity', () => {
    const rawSummary = 'name: Alice\nemail: alice@example.com\nissue: login problem'

    const result = mergeProfile('', rawSummary)
    const sections = parseSections(result.sections)

    // Raw content without headers is treated as Identity
    expect(sections.Identity.length).toBeGreaterThan(0)
    expect(sections.Identity).toContain('name: Alice')
  })

  it('handles empty existing profile gracefully', () => {
    const incoming = markdown({
      Identity: ['name: Bob'],
      Activity: ['first chat'],
    })

    const result = mergeProfile('', incoming)
    const sections = parseSections(result.sections)

    expect(sections.Identity).toEqual(['name: Bob'])
    expect(sections.Activity).toEqual(['first chat'])
  })

  it('handles empty incoming gracefully', () => {
    const existing = markdown({
      Identity: ['name: Carol'],
    })

    const result = mergeProfile(existing, '')
    const sections = parseSections(result.sections)

    // Existing content should be preserved
    expect(sections.Identity).toEqual(['name: Carol'])
  })

  it('handles both empty gracefully', () => {
    const result = mergeProfile('', '')

    expect(result.profile).toBe('# User Profile')
    const sections = parseSections(result.sections)
    expect(totalItems(sections)).toBe(0)
  })
})
