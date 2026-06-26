import { describe, it, expect } from 'vitest'
import { PROFILE_SECTIONS, sectionHeader, type ProfileSection } from '@intera/shared/memory/contract'
import { PROFILE_COMPACT_PROMPT } from '../profile-compact-prompt'

describe('PROFILE_COMPACT_PROMPT', () => {
  it('contains sectionHeader for every section in PROFILE_SECTIONS', () => {
    for (const section of PROFILE_SECTIONS) {
      const header = sectionHeader(section as ProfileSection)
      expect(PROFILE_COMPACT_PROMPT).toContain(header)
    }
  })

  it('contains the exact section count in the prompt text', () => {
    expect(PROFILE_COMPACT_PROMPT).toContain(String(PROFILE_SECTIONS.length))
  })

  it('contains exactly the canonical PROFILE_SECTIONS headers and no extras', () => {
    // Count "## " patterns that are actual Markdown headings, NOT inside backticks.
    // Remove inline-code spans first so `## SectionName` placeholder text is excluded.
    const cleaned = PROFILE_COMPACT_PROMPT.replace(/`[^`]*`/g, '')
    const headerMatches = cleaned.match(/## \w+/g) || []
    const headerTexts = headerMatches.map((m) => m.replace('## ', ''))
    for (const section of PROFILE_SECTIONS) {
      expect(headerTexts).toContain(section)
    }
    // No extra section headers beyond PROFILE_SECTIONS
    const canonicalSet = new Set(PROFILE_SECTIONS as readonly string[])
    for (const h of headerTexts) {
      expect(canonicalSet.has(h)).toBe(true)
    }
  })

  it('warns the model to use exact headers and not reword them', () => {
    expect(PROFILE_COMPACT_PROMPT).toMatch(/exact.*header/i)
    expect(PROFILE_COMPACT_PROMPT).toMatch(/do NOT reword/i)
  })

  it('forbids runtime internals and one-off case artifacts in cross-chat profile summaries', () => {
    expect(PROFILE_COMPACT_PROMPT).toMatch(/Never include tool names, tool calls, tool results/i)
    expect(PROFILE_COMPACT_PROMPT).toMatch(/raw JSON/i)
    expect(PROFILE_COMPACT_PROMPT).toMatch(/internal notes/i)
    expect(PROFILE_COMPACT_PROMPT).toMatch(/Do not store one-off transaction records/i)
    expect(PROFILE_COMPACT_PROMPT).toMatch(/current chat\/case\/segment memory/i)
    expect(PROFILE_COMPACT_PROMPT).toMatch(/Do not promote placeholders, examples, or screenshot-only guesses/i)
  })

  it('requires customer messages to be summarized rather than copied verbatim', () => {
    expect(PROFILE_COMPACT_PROMPT).toMatch(/compress into concise reusable facts/i)
    expect(PROFILE_COMPACT_PROMPT).toMatch(/Do NOT preserve every utterance/i)
    expect(PROFILE_COMPACT_PROMPT).not.toMatch(/Customer messages:\s*never compress/i)
  })

  it('is a non-empty string', () => {
    expect(PROFILE_COMPACT_PROMPT).toBeTruthy()
    expect(typeof PROFILE_COMPACT_PROMPT).toBe('string')
  })
})
