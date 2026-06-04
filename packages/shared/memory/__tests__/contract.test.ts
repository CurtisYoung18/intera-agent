import { describe, it, expect } from 'vitest'
import {
  PROFILE_SECTIONS,
  emptyProfileSections,
  sectionHeader,
  DEFAULT_MEMORY_MODEL,
} from '../contract'

describe('PROFILE_SECTIONS', () => {
  it('has 5 elements in the correct order', () => {
    expect(PROFILE_SECTIONS).toHaveLength(5)
    expect(PROFILE_SECTIONS[0]).toBe('Identity')
    expect(PROFILE_SECTIONS[1]).toBe('Contact')
    expect(PROFILE_SECTIONS[2]).toBe('Preferences')
    expect(PROFILE_SECTIONS[3]).toBe('Activity')
    expect(PROFILE_SECTIONS[4]).toBe('History')
  })
})

describe('emptyProfileSections', () => {
  it('returns an object with 5 empty arrays', () => {
    const sections = emptyProfileSections()
    const keys = Object.keys(sections)
    expect(keys).toHaveLength(5)

    for (const key of keys) {
      expect(Array.isArray(sections[key as keyof typeof sections])).toBe(true)
      expect(sections[key as keyof typeof sections]).toHaveLength(0)
    }
  })
})

describe('sectionHeader', () => {
  it("returns '## Identity' for sectionHeader('Identity')", () => {
    expect(sectionHeader('Identity')).toBe('## Identity')
  })
})

describe('DEFAULT_MEMORY_MODEL', () => {
  it("is 'deepseek-v4-flash'", () => {
    expect(DEFAULT_MEMORY_MODEL).toBe('deepseek-v4-flash')
  })
})
