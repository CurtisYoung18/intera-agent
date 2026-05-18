// Intera Harness — Prompt Placeholder Resolver
// Replaces {{placeholder}} tokens in the system prompt with live data
// from DB/config, so the prompt always reflects Console configuration.

export interface PromptContext {
  case_types?: Array<{ type: string; displayName: string; description?: string }>
  active_policies?: Array<{ name: string; hook: string; description?: string }>
  case_schema?: {
    displayName: string
    goal?: string
    stages: string[]
    requiredFacts: string[]
    escalateOn: string[]
  } | null
  case_state?: {
    confirmedFacts: Record<string, unknown>
    skillsCalled: string[]
    missingFacts: string[]
  } | null
  session_binding?: { userId: string } | null
}

function renderCaseTypes(types: PromptContext['case_types']): string {
  if (!types?.length) return ''
  const lines = types.map(
    (t) => `- **${t.type}** (${t.displayName}): ${t.description || 'No description'}`
  )
  return `## Available Case Types\n\nWhen a customer reports an issue, call \`create_case\` with the matching type:\n\n${lines.join('\n')}`
}

function renderPolicies(policies: PromptContext['active_policies']): string {
  if (!policies?.length) return ''
  const lines = policies.map(
    (p) => `- **${p.name}** (${p.hook}): ${p.description || 'No description'}`
  )
  return `## Active Policies\n\n${lines.join('\n')}\n\nPolicy evaluation is automatic — you do not need to check rules yourself. If a policy blocks or escalates, the system will tell you.`
}

function renderCaseSchema(schema: PromptContext['case_schema']): string {
  if (!schema) return ''
  const parts = [
    `## Case Schema: ${schema.displayName}`,
    schema.goal ? `- Goal: ${schema.goal}` : '',
    `- Stages: ${JSON.stringify(schema.stages)}`,
    `- Required facts: ${JSON.stringify(schema.requiredFacts)}`,
    `- Escalate when: ${JSON.stringify(schema.escalateOn)}`,
  ]
  return parts.filter(Boolean).join('\n')
}

function renderCaseState(state: PromptContext['case_state']): string {
  if (!state) return ''
  if (Object.keys(state.confirmedFacts).length === 0 && state.skillsCalled.length === 0) return ''
  return [
    '## Current Case State',
    `- Confirmed: ${JSON.stringify(state.confirmedFacts)}`,
    `- Skills used: ${JSON.stringify(state.skillsCalled)}`,
    `- Missing: ${JSON.stringify(state.missingFacts)}`,
  ].join('\n')
}

function renderSessionBinding(binding: PromptContext['session_binding']): string {
  if (!binding) return ''
  const u = binding.userId.trim() || 'anonymous'
  return [
    '## Session binding',
    `- **platformUserId** for tools (\`read_case_history\`, etc.): \`${u}\``,
    'Pass this string as the `userId` argument unless the customer explicitly states a different authoritative account identifier.',
  ].join('\n')
}

/** Resolve all {{placeholder}} tokens in a prompt string against live context. */
export function resolvePrompt(prompt: string, ctx: PromptContext): string {
  let result = prompt

  // Replace each placeholder with its rendered block. Blocks that render
  // to empty string are removed (the placeholder is simply dropped).
  const blocks: Record<string, string> = {
    '{{case_types}}': renderCaseTypes(ctx.case_types),
    '{{active_policies}}': renderPolicies(ctx.active_policies),
    '{{case_schema}}': renderCaseSchema(ctx.case_schema ?? null),
    '{{case_state}}': renderCaseState(ctx.case_state ?? null),
    '{{session_binding}}': renderSessionBinding(ctx.session_binding ?? null),
  }

  for (const [placeholder, content] of Object.entries(blocks)) {
    // If content is empty, remove the placeholder line (plus any trailing newline)
    if (!content) {
      result = result.replace(new RegExp(`\\s*${placeholder.replace(/[{}]/g, '\\$&')}\\s*`, 'g'), '\n')
    } else {
      result = result.replace(placeholder, content)
    }
  }

  // Clean up multiple consecutive newlines
  result = result.replace(/\n{3,}/g, '\n\n').trim()

  return result
}

/** Build a PromptContext from DB data for a given customer. */
export async function buildPromptContext(params: {
  customerId: string
  caseSchema?: PromptContext['case_schema']
  caseState?: PromptContext['case_state']
  sessionBinding?: PromptContext['session_binding']
}): Promise<PromptContext> {
  const { prisma } = await import('@intera/shared/prisma')

  const [caseTypes, policies] = await Promise.all([
    prisma.caseType.findMany({
      where: { customerId: params.customerId, enabled: true },
      select: { type: true, displayName: true, description: true },
    }),
    prisma.policy.findMany({
      where: { customerId: params.customerId, enabled: true },
      select: { name: true, hook: true, description: true },
    }),
  ])

  return {
    case_types: caseTypes.map((t) => ({ ...t, description: t.description ?? undefined })),
    active_policies: policies.map((p) => ({ ...p, description: p.description ?? undefined })),
    case_schema: params.caseSchema ?? null,
    case_state: params.caseState ?? null,
    session_binding: params.sessionBinding ?? null,
  }
}
