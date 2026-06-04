export const PROFILE_SECTIONS = ['Identity', 'Contact', 'Preferences', 'Activity', 'History'] as const
export type ProfileSection = typeof PROFILE_SECTIONS[number]
export type ProfileSections = Record<ProfileSection, string[]>

export function emptyProfileSections(): ProfileSections {
  return {
    Identity: [],
    Contact: [],
    Preferences: [],
    Activity: [],
    History: [],
  }
}

export function sectionHeader(s: ProfileSection): string {
  return `## ${s}`
}

export const DEFAULT_MEMORY_MODEL = 'deepseek-v4-flash'
