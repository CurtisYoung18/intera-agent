import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'node:url'

const LEGACY_ACTIONS = new Set(['use', 'read', 'ask', 'decide', 'tag', 'escalate', 'finalize'])
const V2_ACTIONS = new Set(['ask', 'search_knowledge', 'call_tool', 'request_human_handoff', 'end'])
const DEFAULT_WHEN_TO_USE = 'Migrated from a legacy Procedure v1 definition. Review and refine before production use.'
const DEFAULT_OVERVIEW = 'Auto-migrated from the legacy Procedure v1 shape.'

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseJsonStrict(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function looksLikeLegacyProcedure(value) {
  if (!isRecord(value) || !Array.isArray(value.steps) || value.steps.length === 0) return false
  if (value.version === 1) return true
  return value.steps.some((step) => isRecord(step) && typeof step.action === 'string' && LEGACY_ACTIONS.has(step.action))
}

export function isProcedureV2Shape(value) {
  if (!isRecord(value) || value.version !== 'v2' || !Array.isArray(value.steps) || value.steps.length === 0) return false
  return value.steps.every((step) => {
    if (!isRecord(step) || typeof step.id !== 'string' || typeof step.title !== 'string' || typeof step.guidance !== 'string') return false
    const actions = Array.isArray(step.actions) ? step.actions : []
    return actions.every((action) => isRecord(action) && typeof action.kind === 'string' && V2_ACTIONS.has(action.kind))
  })
}

function asNonEmptyString(value, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function splitFields(target, fallback) {
  const raw = asNonEmptyString(target, fallback)
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function legacyStepTitle(step, index) {
  const target = asNonEmptyString(step.target)
  switch (step.action) {
    case 'ask':
      return target ? `Ask for ${target}` : `Ask customer (${index + 1})`
    case 'use':
      return target ? `Run ${target}` : `Run tool (${index + 1})`
    case 'read':
      return target ? `Read ${target}` : `Read supporting context`
    case 'escalate':
      return target ? `Hand off to ${target}` : 'Request human handoff'
    case 'finalize':
      return target ? `End as ${target}` : 'End procedure'
    case 'tag':
      return target ? `Apply tag ${target}` : 'Apply case tag'
    case 'decide':
    default:
      return `Decision step ${index + 1}`
  }
}

function legacyStepGuidance(step) {
  return asNonEmptyString(step.guidance, `Migrated from legacy ${step.action} step.`)
}

function looksLikeSkipOnly(text) {
  const value = asNonEmptyString(text).toLowerCase()
  return value.includes('skip') || value.includes('unless') || value.includes('otherwise')
}

function buildActionFromLegacyStep(step, index) {
  const target = asNonEmptyString(step.target)
  switch (step.action) {
    case 'ask':
      return {
        id: `${step.id}_ask`,
        kind: 'ask',
        label: legacyStepTitle(step, index),
        guidance: asNonEmptyString(step.guidance),
        required: !!step.required,
        fields: splitFields(target, `field_${index + 1}`),
      }
    case 'use':
      return {
        id: `${step.id}_tool`,
        kind: 'call_tool',
        label: legacyStepTitle(step, index),
        guidance: asNonEmptyString(step.guidance),
        required: !!step.required,
        toolName: target || `tool_${step.id}`,
      }
    case 'read':
      if (target.startsWith('kb_search_') || target.toLowerCase().includes('knowledge')) {
        return {
          id: `${step.id}_knowledge`,
          kind: 'search_knowledge',
          label: legacyStepTitle(step, index),
          guidance: asNonEmptyString(step.guidance),
          required: !!step.required,
          suggestedSources: target ? [target] : [],
        }
      }
      return {
        id: `${step.id}_tool`,
        kind: 'call_tool',
        label: legacyStepTitle(step, index),
        guidance: asNonEmptyString(step.guidance),
        required: !!step.required,
        toolName: target || `tool_${step.id}`,
      }
    case 'escalate':
      return {
        id: `${step.id}_handoff`,
        kind: 'request_human_handoff',
        label: legacyStepTitle(step, index),
        guidance: asNonEmptyString(step.guidance),
        required: true,
        queue: target || undefined,
      }
    case 'finalize':
      return {
        id: `${step.id}_end`,
        kind: 'end',
        label: legacyStepTitle(step, index),
        guidance: asNonEmptyString(step.guidance),
        required: true,
        status: target === 'cancelled' ? 'cancelled' : 'completed',
      }
    default:
      return null
  }
}

function buildStepFromLegacy(step, index) {
  const action = buildActionFromLegacyStep(step, index)
  const completionGuidance =
    step.required && (step.action === 'use' || step.action === 'read')
      ? `Only continue after ${asNonEmptyString(step.target, 'the required tool')} succeeds.`
      : ''
  const skipGuidance = step.when && looksLikeSkipOnly(step.when) ? step.when : ''
  const branches =
    step.when && !skipGuidance && action
      ? [{
          id: `${step.id}_when`,
          kind: 'if',
          label: `Migrated condition for ${step.id}`,
          condition: {
            id: `${step.id}_when_eval`,
            kind: 'llm_eval',
            prompt: step.when,
          },
          actions: [{ ...action, id: `${action.id}_conditional` }],
        }]
      : []

  return {
    id: step.id,
    title: legacyStepTitle(step, index),
    guidance: legacyStepGuidance(step),
    actions: branches.length > 0 ? [] : (action ? [action] : []),
    branches,
    skipGuidance: skipGuidance || undefined,
    completionGuidance: completionGuidance || undefined,
  }
}

export function migrateLegacyProcedureToV2(legacyProcedure) {
  if (!looksLikeLegacyProcedure(legacyProcedure)) {
    throw new Error('Input is not a legacy Procedure v1 definition.')
  }
  const steps = legacyProcedure.version === 1
    ? legacyProcedure.steps.map((step, index) => buildStepFromRuntimeV1(step, index))
    : legacyProcedure.steps.map((step, index) => buildStepFromLegacy(step, index))
  return {
    version: 'v2',
    whenToUse: DEFAULT_WHEN_TO_USE,
    overview: DEFAULT_OVERVIEW,
    knowledgeGuidance: '',
    handoffGuidance: '',
    steps,
    legacy: {
      procedureV1: legacyProcedure,
    },
  }
}

function buildActionFromRuntimeV1Tool(toolName, step, index) {
  switch (toolName) {
    case 'ask_user_questions':
      return {
        id: `${step.id}_ask`,
        kind: 'ask',
        label: step.title || `Ask customer (${index + 1})`,
        guidance: asNonEmptyString(step.instructions),
        required: true,
        fields: Array.isArray(step.requiredFacts) && step.requiredFacts.length > 0 ? step.requiredFacts : [`field_${index + 1}`],
      }
    case 'finalize_procedure':
      return {
        id: `${step.id}_end`,
        kind: 'end',
        label: step.title || 'End procedure',
        guidance: asNonEmptyString(step.instructions),
        required: true,
        status: 'completed',
      }
    case 'create_human_task':
    case 'read_chat_memory':
      return null
    default:
      return {
        id: `${step.id}_${toolName}`,
        kind: 'call_tool',
        label: `${step.title || 'Run tool'}: ${toolName}`,
        guidance: asNonEmptyString(step.instructions),
        required: Array.isArray(step.requiredToolsAny) ? step.requiredToolsAny.includes(toolName) : false,
        toolName,
      }
  }
}

function buildRuntimeV1HandoffAction(step) {
  return {
    id: `${step.id}_handoff`,
    kind: 'request_human_handoff',
    label: step.title || 'Request human handoff',
    guidance: asNonEmptyString(step.instructions),
  }
}

function buildRuntimeV1HandoffBranch(step) {
  const title = asNonEmptyString(step.title, step.id || 'this step')
  return {
    id: `${step.id}_handoff_if_manual_review_needed`,
    kind: 'if',
    label: `Escalate ${title} when human review is needed`,
    condition: {
      id: `${step.id}_handoff_eval`,
      kind: 'llm_eval',
      prompt: `Based on the latest customer message and the evidence gathered for "${title}", should this step hand the case to a human because manual review, conflict resolution, or a safe escalation is required?`,
    },
    actions: [buildRuntimeV1HandoffAction(step)],
  }
}

function buildStepFromRuntimeV1(step, index) {
  const allowedTools = Array.isArray(step.allowedTools) ? step.allowedTools : []
  const hasHandoffTool = allowedTools.includes('create_human_task')
  const actions = allowedTools
    .map((toolName) => buildActionFromRuntimeV1Tool(toolName, step, index))
    .filter(Boolean)
  const guidanceBits = []
  if (Array.isArray(step.requiredToolsAny) && step.requiredToolsAny.length > 0) {
    guidanceBits.push(`Only continue after one of these tools succeeds: ${step.requiredToolsAny.join(', ')}.`)
  }
  if (hasHandoffTool && actions.length > 0) {
    guidanceBits.push('If the evidence conflicts, the customer explicitly asks for a human, or safe completion is not possible, request human handoff instead of forcing an answer.')
  }
  const completionGuidance = guidanceBits.length > 0 ? guidanceBits.join(' ') : undefined
  const branches = hasHandoffTool && actions.length > 0 ? [buildRuntimeV1HandoffBranch(step)] : []
  const directActions = hasHandoffTool && actions.length === 0
    ? [buildRuntimeV1HandoffAction(step)]
    : actions
  return {
    id: asNonEmptyString(step.id, `step_${index + 1}`),
    title: asNonEmptyString(step.title, `Migrated step ${index + 1}`),
    guidance: asNonEmptyString(step.instructions, `Migrated from legacy Procedure v1 step ${index + 1}.`),
    actions: directActions,
    branches,
    skipGuidance: undefined,
    completionGuidance,
  }
}

export function normalizeStoredProcedure(rawProcedure) {
  const parsed = typeof rawProcedure === 'string' ? parseJsonStrict(rawProcedure) : rawProcedure
  if (!parsed) {
    return { status: 'invalid', reason: 'procedure is not valid JSON' }
  }
  if (isProcedureV2Shape(parsed)) {
    return { status: 'v2', definition: parsed }
  }
  if (looksLikeLegacyProcedure(parsed)) {
    return { status: 'legacy', definition: migrateLegacyProcedureToV2(parsed) }
  }
  return { status: 'invalid', reason: 'procedure is neither a v2 definition nor a recognizable legacy Procedure v1 shape' }
}

async function run() {
  const prisma = new PrismaClient()
  const dryRun = process.argv.includes('--dry-run')
  try {
    const rows = await prisma.caseType.findMany({
      where: { NOT: { procedure: null } },
      select: { id: true, type: true, procedure: true },
      orderBy: { type: 'asc' },
    })

    const summary = {
      dryRun,
      scanned: rows.length,
      migrated: 0,
      alreadyV2: 0,
      invalid: 0,
      failures: [],
    }

    for (const row of rows) {
      const normalized = normalizeStoredProcedure(row.procedure)
      if (normalized.status === 'v2') {
        summary.alreadyV2 += 1
        continue
      }
      if (normalized.status === 'invalid') {
        summary.invalid += 1
        summary.failures.push({ id: row.id, type: row.type, reason: normalized.reason })
        continue
      }
      summary.migrated += 1
      if (!dryRun) {
        await prisma.caseType.update({
          where: { id: row.id },
          data: { procedure: JSON.stringify(normalized.definition) },
        })
      }
    }

    console.log(JSON.stringify(summary, null, 2))
    if (summary.invalid > 0) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((error) => {
    console.error('[migrate-procedures-v1-to-v2] failed')
    console.error(error)
    process.exit(1)
  })
}
