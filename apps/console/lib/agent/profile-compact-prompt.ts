// User-portrait prompt for L3 cross-chat profile compaction.
// Produces a structured profile that feeds into mergeProfile, which parses
// `## Identity`, `## Contact`, `## Preferences`, `## Activity`, `## History`
// sections from the output.
//
// The sections array is imported from the shared contract so the prompt can
// NEVER drift from the parser. Every section header used below is generated
// via sectionHeader() from the same PROFILE_SECTIONS const that the parser reads.

import { PROFILE_SECTIONS, sectionHeader, type ProfileSection } from '@intera/shared/memory/contract'
import { DEFAULT_MEMORY_MODEL } from '@intera/shared/memory/contract'

// Build the sections block by iterating the canonical PROFILE_SECTIONS array.
// This guarantees the prompt and parser always agree on section names and order.
const sectionsBlock = PROFILE_SECTIONS.map((s: ProfileSection, i: number) => {
  const header = sectionHeader(s)
  const descriptions: Record<ProfileSection, string> = {
    Identity: 'Everything known about this person — identifiers, affiliations, roles, status. Any stable attributes that persist across sessions. Put these FIRST.',
    Contact: 'Any contact information or communication channels mentioned or confirmed.',
    Preferences: 'Recurring topics, preferred tone or format, common requests, language choices, behavioral patterns. Accumulate these across sessions.',
    Activity: 'Summary of recent conversations and cases. What they asked about, what was resolved, what tools were used. One line per interaction.',
    History: 'Long-term patterns, recurring issues, escalation frequency, relationship notes. Aggregate across all past sessions.',
  }
  return `${i + 1}. ${header}: ${descriptions[s]}`
}).join('\n\n')

const sectionList = PROFILE_SECTIONS.map((s: ProfileSection) => `## ${s}`).join(', ')

export const PROFILE_COMPACT_PROMPT = `Summarize this conversation as a user portrait. Structure it so that the most stable, reusable facts come first, and transient case details come last.

Output using the EXACT section headers shown below. The parser expects these precise headers — do NOT reword, reorder, or omit any section.

${sectionsBlock}

YOU MUST use these exact Markdown headers for each section:
${PROFILE_SECTIONS.map((s: ProfileSection) => `- ${sectionHeader(s)}`).join('\n')}

CRITICAL: The parser extracts content between \`## SectionName\` headers. If you use different wording (e.g. "About the User" instead of "## Identity"), the parser will miss that section entirely. Output ONLY the ${PROFILE_SECTIONS.length} section headers listed above — no extra sections, no combined sections.

COMPRESSION RULES:
- Facts older than 7 days: one-line summary only.
- Facts older than 30 days: merge into a single aggregate line.
- Customer messages: never compress. Every utterance matters.
- Duplicate facts: keep the most recent value.
- If the token budget is tight, prioritize Identity, Contact, and Preferences over Activity and History.

Respond with TEXT ONLY — no tool calls, no analysis tags, no thinking blocks. Output just the ${PROFILE_SECTIONS.length} sections with the exact headers above.`
