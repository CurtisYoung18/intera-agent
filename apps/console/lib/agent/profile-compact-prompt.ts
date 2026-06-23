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
    Identity: 'Stable facts about this person only — identifiers, roles, durable account status, or other attributes that persist across sessions. Put these FIRST.',
    Contact: 'Confirmed contact information or durable communication channels only.',
    Preferences: 'Recurring preferences such as language, tone, format, contact style, or repeated support needs. Accumulate these across sessions.',
    Activity: 'User-visible recent support topics and outcomes only. Keep at most a few concise lines; do not preserve every utterance.',
    History: 'Long-term patterns, recurring issues, escalation frequency, and relationship notes. Aggregate across sessions.',
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
- Customer messages: compress into concise reusable facts and outcomes. Do NOT preserve every utterance.
- Duplicate facts: keep the most recent value.
- If the token budget is tight, prioritize Identity, Contact, and Preferences over Activity and History.
- Never include tool names, tool calls, tool results, raw JSON, internal notes, hook feedback, trace IDs, run IDs, case IDs, task IDs, or model/runtime details.
- Do not store one-off transaction records, receipt/screenshot filenames, temporary status checks, or dispute evidence in the cross-chat profile. Those belong in the current chat/case memory.
- If a recent conversation produced no durable user fact, leave the relevant section empty instead of inventing a profile item.

Respond with TEXT ONLY — no tool calls, no analysis tags, no thinking blocks. Output just the ${PROFILE_SECTIONS.length} sections with the exact headers above.`
