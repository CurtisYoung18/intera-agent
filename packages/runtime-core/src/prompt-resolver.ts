// Intera Harness — Prompt Placeholder Resolver
// Replaces {{placeholder}} tokens in the system prompt with live data
// from DB/config, so the prompt always reflects Console configuration.

import { isOpaqueInternalUserId, isVerifiedMemberId } from './identity'

export interface ToolSummary {
  name: string
  description: string
  needsMemberId: boolean
  knowledgeSourceId?: string
}

export interface PromptContext {
  case_types?: Array<{ type: string; displayName: string; description?: string }>
  active_hooks?: Array<{ name: string; checkpoint: string; description?: string }>
  case_schema?: {
    displayName: string
    goal?: string
    requiredFacts: string[]
    escalateOn: string[]
  } | null
  case_state?: {
    toolsCalled: string[]
    missingFacts: string[]
    keyEvents?: Array<{ at: string; text: string; source: string }>
    summary?: string
  } | null
  session_binding?: { userId: string; userLabel?: string } | null
  available_tools?: ToolSummary[]
}

function renderCaseTypes(types: PromptContext['case_types']): string {
  if (!types?.length) return ''
  const lines = types.map(
    (t) => `- **${t.type}** (${t.displayName}): ${t.description || 'No description'}`
  )
  return `## Available Procedures\n\nWhen a customer reports an issue that needs a guided runtime, call \`start_procedure\` with the matching procedureId:\n\n${lines.join('\n')}`
}

function renderHooks(hooks: PromptContext['active_hooks']): string {
  if (!hooks?.length) return ''
  const lines = hooks.map(
    (hook) => `- **${hook.name}** (${hook.checkpoint}): ${hook.description || 'No description'}`
  )
  return `## Active Hooks\n\n${lines.join('\n')}\n\nWhen a Hook gives feedback, read it and adjust your behavior before retrying the action.`
}

function renderCaseSchema(schema: PromptContext['case_schema']): string {
  if (!schema) return ''
  const parts = [
    `## Procedure Type Schema: ${schema.displayName}`,
    schema.goal ? `- Goal: ${schema.goal}` : '',
    `- Required facts: ${JSON.stringify(schema.requiredFacts)}`,
    `- Escalate when: ${JSON.stringify(schema.escalateOn)}`,
  ]
  return parts.filter(Boolean).join('\n')
}

function renderCaseState(state: PromptContext['case_state']): string {
  if (!state) return ''
  const recentEvents = (state.keyEvents ?? [])
    .map((event) => event.text)
    .filter((text) => typeof text === 'string' && !text.includes('__intera_'))
    .slice(-5)
  if (!state.summary && recentEvents.length === 0 && state.toolsCalled.length === 0 && state.missingFacts.length === 0) return ''

  const lines = ['## Current Chat Context']
  if (state.summary?.trim()) {
    lines.push(`- Summary: ${state.summary.trim()}`)
  }
  if (recentEvents.length > 0) {
    lines.push(`- Recent events: ${JSON.stringify(recentEvents)}`)
  }
  if (state.toolsCalled.length > 0) {
    lines.push(`- Tools used: ${JSON.stringify(state.toolsCalled)}`)
  }
  if (state.missingFacts.length > 0) {
    lines.push(`- Missing: ${JSON.stringify(state.missingFacts)}`)
  }
  return lines.join('\n')
}

function renderTools(tools: PromptContext['available_tools']): string {
  if (!tools?.length) return ''
  const kbTools = tools.filter((tool) => !!tool.knowledgeSourceId)
  const lookupTools = tools.filter((tool) => !tool.knowledgeSourceId && tool.needsMemberId)
  const otherTools = tools.filter((tool) => !tool.knowledgeSourceId && !tool.needsMemberId)

  const lines: string[] = ['## Available Tools']
  if (kbTools.length) {
    lines.push('\n**Knowledge Bases** (call for any factual question — FAQs, policies, contact info, how-to):')
    for (const t of kbTools) lines.push(`- ${t.name}: ${t.description}`)
  }
  if (lookupTools.length) {
    lines.push('\n**Account Lookups** (all require member_id — if member_id is missing, ask_user_questions is mandatory and plain-text collection is not allowed):')
    for (const t of lookupTools) lines.push(`- ${t.name}: ${t.description}`)
  }
  if (otherTools.length) {
    lines.push('\n**Actions**:')
    for (const t of otherTools) lines.push(`- ${t.name}: ${t.description}`)
  }
  return lines.join('\n')
}

function renderSessionBinding(binding: PromptContext['session_binding']): string {
  if (!binding) return ''
  const u = binding.userId.trim() || 'anonymous'
  const label = binding.userLabel?.trim()
  const lines = ['## Current User']
  if (label) lines.push(`- Label: ${label}`)

  // Emit ONLY the dynamic facts here. The behavioral instruction (use the
  // Member ID vs. collect it via ask_user_questions) lives in the editable
  // System Prompt (`## member_id` section), so it can be hot-updated in Console.
  // BUG-G: LiveChat's author_id is a random UUID, not a business member_id —
  // surface that distinction as a fact, not a hardcoded instruction.
  if (isOpaqueInternalUserId(u) || !isVerifiedMemberId(u)) {
    lines.push(`- Session ID: \`${u}\``)
    lines.push('- member_id: 未知 / unknown (not yet provided by the customer)')
  } else {
    lines.push(`- Member ID: \`${u}\` (verified)`)
  }
  return lines.join('\n')
}

/** Resolve all {{placeholder}} tokens in a prompt string against live context. */
export function resolvePrompt(prompt: string, ctx: PromptContext): string {
  let result = prompt

  // Replace each placeholder with its rendered block. Blocks that render
  // to empty string are removed (the placeholder is simply dropped).
  const blocks: Record<string, string> = {
    '{{case_types}}': renderCaseTypes(ctx.case_types),
    '{{active_hooks}}': renderHooks(ctx.active_hooks),
    '{{case_schema}}': renderCaseSchema(ctx.case_schema ?? null),
    '{{case_state}}': renderCaseState(ctx.case_state ?? null),
    '{{session_binding}}': renderSessionBinding(ctx.session_binding ?? null),
    '{{available_tools}}': renderTools(ctx.available_tools),
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
  agentConfigId: string
  caseSchema?: PromptContext['case_schema']
  caseState?: PromptContext['case_state']
  sessionBinding?: PromptContext['session_binding']
  available_tools?: PromptContext['available_tools']
}): Promise<PromptContext> {
  const { prisma } = await import('@intera/shared/prisma')

  const [caseTypes, hookBindings] = await Promise.all([
    prisma.caseType.findMany({
      where: { agentConfigId: params.agentConfigId, enabled: true },
      select: { type: true, displayName: true, description: true },
    }),
    prisma.hookBinding.findMany({
      where: {
        agentConfigId: params.agentConfigId,
        enabled: true,
        hook: { enabled: true },
      },
      distinct: ['hookId'],
      select: {
        hook: {
          select: { name: true, checkpoint: true, description: true },
        },
      },
    }),
  ])

  const hooks = Array.from(
    new Map(
      hookBindings
        .map((binding) => binding.hook)
        .filter((hook): hook is NonNullable<typeof hook> => Boolean(hook))
        .map((hook) => [hook.name, hook]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name))

  return {
    case_types: caseTypes.map((t) => ({ ...t, description: t.description ?? undefined })),
    active_hooks: hooks.map((hook) => ({ ...hook, description: hook.description ?? undefined })),
    case_schema: params.caseSchema ?? null,
    case_state: params.caseState ?? null,
    session_binding: params.sessionBinding ?? null,
    available_tools: params.available_tools ?? [],
  }
}
