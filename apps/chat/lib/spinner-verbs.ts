// Spinner Verbs — customer service loading phrases
// Inspired by Claude Code's spinnerVerbs.ts (200+ verbs)
// Each verb maps to an SVG icon type for visual variety

export type IconType = 'dots' | 'pulse' | 'spin' | 'scan'

export interface SpinnerVerb {
  text: string
  icon: IconType
}

// General thinking verbs — rotate randomly during thinking phase
const THINKING_VERBS: SpinnerVerb[] = [
  { text: 'Understanding your request', icon: 'dots' },
  { text: 'Listening carefully', icon: 'dots' },
  { text: 'Reading your message', icon: 'dots' },
  { text: 'Processing your query', icon: 'pulse' },
  { text: 'Analyzing the situation', icon: 'pulse' },
  { text: 'Considering options', icon: 'dots' },
  { text: 'Gathering context', icon: 'scan' },
  { text: 'Reviewing details', icon: 'scan' },
  { text: 'Thinking through this', icon: 'pulse' },
  { text: 'Putting the pieces together', icon: 'spin' },
]

// Tool-specific verbs — shown when tools are executing
const TOOL_VERBS: Record<string, SpinnerVerb> = {
  request_user_input:        { text: 'Preparing a question for you', icon: 'pulse' },
  query_order_status:        { text: 'Checking order status', icon: 'scan' },
  query_payment_channel_status: { text: 'Verifying payment channel', icon: 'scan' },
  search_delay_notice:       { text: 'Searching for platform notices', icon: 'scan' },
  ocr_receipt:               { text: 'Reading your screenshot', icon: 'spin' },
  read_case_history:         { text: 'Looking up past cases', icon: 'scan' },
  kb_hybrid_retrieve:        { text: 'Searching knowledge base', icon: 'dots' },
  create_human_task:         { text: 'Escalating to a specialist', icon: 'pulse' },
  finalize_case:             { text: 'Wrapping up your case', icon: 'spin' },
}

// Default when no specific tool matches
const DEFAULT_EXECUTING: SpinnerVerb = { text: 'Working on your request', icon: 'spin' }

// Post-thinking summary (like CC's "Thought for Ns")
const POST_THINKING_VERBS: SpinnerVerb[] = [
  { text: 'Getting your answer ready', icon: 'dots' },
  { text: 'Almost there', icon: 'pulse' },
  { text: 'Putting it together', icon: 'spin' },
]

/**
 * Pick a random thinking verb, avoiding the previous one.
 */
export function pickThinkingVerb(previousIndex?: number): { verb: SpinnerVerb; index: number } {
  let index: number
  do {
    index = Math.floor(Math.random() * THINKING_VERBS.length)
  } while (index === previousIndex && THINKING_VERBS.length > 1)
  return { verb: THINKING_VERBS[index], index }
}

/**
 * Get the verb matching an active tool, or the default executing verb.
 */
export function pickToolVerb(toolName?: string): SpinnerVerb {
  if (toolName && TOOL_VERBS[toolName]) {
    return TOOL_VERBS[toolName]
  }
  return DEFAULT_EXECUTING
}

/**
 * Pick a random post-thinking verb.
 */
export function pickPostThinkingVerb(): SpinnerVerb {
  return POST_THINKING_VERBS[Math.floor(Math.random() * POST_THINKING_VERBS.length)]
}
