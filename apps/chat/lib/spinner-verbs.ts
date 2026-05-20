// Spinner Verbs — customer service loading phrases
// Inspired by Claude Code's spinnerVerbs.ts — random variants + tool-linked captions

export type IconType = 'dots' | 'pulse' | 'spin' | 'scan'

export interface SpinnerVerb {
  text: string
  icon: IconType
}

// Uppercase eyebrow labels (rotate like CC phase chips)
export const PROGRESS_EYEBROWS: string[] = [
  'HELPING YOU',
  'ON YOUR CASE',
  'WORKING ON IT',
  'ASSISTING NOW',
  'HERE FOR YOU',
  'HANDLING THIS',
  'WITH YOU',
  'ALMOST THERE',
  'CHECKING DETAILS',
]

export function pickRandomEyebrow(exclude?: string): string {
  const pool = PROGRESS_EYEBROWS
  if (pool.length <= 1) return pool[0] ?? 'HELPING YOU'
  let pick = pool[Math.floor(Math.random() * pool.length)]!
  let guard = 0
  while (pick === exclude && guard++ < 10) {
    pick = pool[Math.floor(Math.random() * pool.length)]!
  }
  return pick
}

// General thinking verbs — rotate randomly while model thinks (no tool yet)
const THINKING_VERBS: SpinnerVerb[] = [
  { text: 'Reading your message', icon: 'dots' },
  { text: 'Understanding what you need', icon: 'dots' },
  { text: 'Checking the situation', icon: 'pulse' },
  { text: 'Pulling up relevant context', icon: 'scan' },
  { text: 'Tracing what happened', icon: 'scan' },
  { text: 'Reviewing your account trail', icon: 'pulse' },
  { text: 'Connecting the details', icon: 'spin' },
  { text: 'Drafting next steps', icon: 'dots' },
  { text: 'Sorting out your request', icon: 'dots' },
  { text: 'Following your thread', icon: 'pulse' },
]

/** Lines when no tool hint — overlaps with responding-bubble “Intera is …” pool */
export const GENERAL_LOADING_LINES: string[] = [
  'examining your order',
  'checking payment channels',
  'reviewing your case',
  'looking into this',
  'analyzing transaction data',
  'verifying deposit status',
  'tracing the payment',
  'consulting our records',
  'reviewing details',
  'processing your request',
  'checking the status',
  'pulling up your information',
  'following the paper trail',
  'lining up the facts',
  'preparing a clear answer',
]

export function pickRandomGeneralLine(exclude?: string): string {
  const pool = [...THINKING_VERBS.map((v) => v.text), ...GENERAL_LOADING_LINES]
  let pick = pool[Math.floor(Math.random() * pool.length)]!
  let guard = 0
  while (pick === exclude && pool.length > 1 && guard++ < 10) {
    pick = pool[Math.floor(Math.random() * pool.length)]!
  }
  return pick
}

// TOOL_VERB_VARIANTS removed — display text is now defined on each SkillDefinition
// as `displayVerb` and forwarded by the server in the `tool_executing` SSE event.
// The pickRandomToolVerb function below is kept only as a fallback for cases where
// the server does not send displayVerb (e.g. very old clients, unregistered tools).

const DEFAULT_EXECUTING_VARIANTS: SpinnerVerb[] = [
  { text: 'Working on your request', icon: 'spin' },
  { text: 'Running a backend check', icon: 'pulse' },
  { text: 'Executing the next step', icon: 'scan' },
]

// Post-thinking summary (like CC's "Thought for Ns")
const POST_THINKING_VERBS: SpinnerVerb[] = [
  { text: 'Getting your reply ready', icon: 'dots' },
  { text: 'Almost ready for you', icon: 'pulse' },
  { text: 'Finishing up', icon: 'spin' },
]

/**
 * Pick a random thinking verb, avoiding the previous one.
 */
export function pickThinkingVerb(previousIndex?: number): { verb: SpinnerVerb; index: number } {
  let index: number
  do {
    index = Math.floor(Math.random() * THINKING_VERBS.length)
  } while (index === previousIndex && THINKING_VERBS.length > 1)
  return { verb: THINKING_VERBS[index]!, index }
}

/**
 * Fallback verb for a tool name when no server-provided displayVerb is available.
 * Prefers a human-readable formatted tool name over the generic placeholder.
 */
export function pickRandomToolVerb(toolName?: string): SpinnerVerb {
  if (toolName) {
    const readable = toolName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
    return { text: `Checking: ${readable}`, icon: 'scan' }
  }
  return DEFAULT_EXECUTING_VARIANTS[Math.floor(Math.random() * DEFAULT_EXECUTING_VARIANTS.length)]!
}

/**
 * Legacy single-variant lookup — prefer pickRandomToolVerb for UI variety.
 */
export function pickToolVerb(toolName?: string): SpinnerVerb {
  return pickRandomToolVerb(toolName)
}

/** Caption driven by tools already invoked this turn (customer-visible trail). */
export function pickCaptionFromSkillsCalled(skillsCalled: string[], excludeLine?: string): string {
  if (!skillsCalled.length) return pickRandomGeneralLine(excludeLine)
  const skill = skillsCalled[Math.floor(Math.random() * skillsCalled.length)]!
  const line = pickRandomToolVerb(skill).text
  if (line !== excludeLine || skillsCalled.length === 1) return line
  const alt = skillsCalled.filter((s) => pickRandomToolVerb(s).text !== excludeLine)
  if (alt.length === 0) return line
  return pickRandomToolVerb(alt[Math.floor(Math.random() * alt.length)]!).text
}

/**
 * Pick a random post-thinking verb.
 */
export function pickPostThinkingVerb(): SpinnerVerb {
  return POST_THINKING_VERBS[Math.floor(Math.random() * POST_THINKING_VERBS.length)]!
}
