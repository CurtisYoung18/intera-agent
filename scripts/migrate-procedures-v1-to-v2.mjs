import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const LEGACY_ACTIONS = new Set(['use', 'read', 'ask', 'decide', 'tag', 'escalate', 'finalize'])
const V2_ACTIONS = new Set(['ask', 'search_knowledge', 'call_tool', 'request_human_handoff', 'end'])
const DEFAULT_WHEN_TO_USE = 'Migrated from a legacy Procedure v1 definition. Review and refine before production use.'
const DEFAULT_OVERVIEW = 'Auto-migrated from the legacy Procedure v1 shape.'
const REQUIRED_TOOL_OVERRIDES_BY_CASE_TYPE = new Map([
  ['login_password_reset', new Set(['get_account_status'])],
  ['withdrawal_password_reset', new Set(['get_account_status'])],
])

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

function parseStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  if (typeof value !== 'string' || value.trim().length === 0) return []
  const parsed = parseJsonStrict(value)
  if (Array.isArray(parsed)) {
    return parsed
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => asNonEmptyString(value)).filter(Boolean))]
}

function fieldKeyFromRecord(value) {
  if (!isRecord(value)) return ''
  return asNonEmptyString(value.key)
    || asNonEmptyString(value.id)
    || asNonEmptyString(value.name)
    || asNonEmptyString(value.field)
}

function extractFieldKeys(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((entry) => {
      if (typeof entry === 'string') return splitFields(entry, '')
      if (isRecord(entry)) return [fieldKeyFromRecord(entry)]
      return []
    }))
  }
  if (typeof value === 'string') return splitFields(value, '')
  if (!isRecord(value)) return []
  if (isRecord(value.properties)) {
    return uniqueStrings(Object.keys(value.properties))
  }
  return uniqueStrings([
    fieldKeyFromRecord(value),
    ...extractFieldKeys(value.fields),
    ...extractFieldKeys(value.formFields),
    ...extractFieldKeys(value.questions),
  ])
}

function collectAskStepFields(step) {
  if (!isRecord(step)) return []
  return uniqueStrings([
    ...extractFieldKeys(step.fields),
    ...extractFieldKeys(step.formFields),
    ...extractFieldKeys(step.askFields),
    ...extractFieldKeys(step.questions),
    ...extractFieldKeys(step.form),
    ...extractFieldKeys(step.input),
    ...extractFieldKeys(step.toolInput),
    ...extractFieldKeys(step.schema),
    ...extractFieldKeys(step.inputSchema),
  ])
}

function isSyntheticBucketField(field) {
  const normalized = asNonEmptyString(field)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
  return normalized.endsWith('_details') || normalized.endsWith('_detail')
}

function resolveAskFields(rawFields, fallbackFields, context) {
  const explicitAskFields = uniqueStrings(context?.askStepFields ?? [])
  const fields = uniqueStrings(rawFields.length > 0
    ? rawFields
    : explicitAskFields.length > 0
      ? explicitAskFields
      : fallbackFields)
  const caseTypeRequiredFacts = uniqueStrings(context?.caseTypeRequiredFacts ?? [])
  const syntheticFields = fields.filter(isSyntheticBucketField)
  if (syntheticFields.length === 0) {
    return fields.length > 0 ? fields : caseTypeRequiredFacts
  }
  const granularFields = uniqueStrings([
    ...explicitAskFields,
    ...caseTypeRequiredFacts,
  ]).filter((field) => !isSyntheticBucketField(field))
  if (granularFields.length === 0) {
    throw new Error(`Synthetic ask field(s) ${syntheticFields.join(', ')} require explicit ask fields or caseType.requiredFacts for expansion.`)
  }
  return granularFields
}

export function collectSyntheticBucketReferences(definition) {
  if (!isProcedureV2Shape(definition)) return []
  const refs = []
  const inspectActions = (actions, stepId, location) => {
    for (const action of Array.isArray(actions) ? actions : []) {
      if (!isRecord(action) || action.kind !== 'ask' || !Array.isArray(action.fields)) continue
      for (const field of action.fields) {
        if (typeof field === 'string' && isSyntheticBucketField(field)) {
          refs.push({ stepId, location, field })
        }
      }
    }
  }

  for (const step of definition.steps) {
    inspectActions(step.actions, step.id, 'step.actions')
    for (const branch of Array.isArray(step.branches) ? step.branches : []) {
      inspectActions(branch.actions, step.id, `branch:${branch.id}.actions`)
      if (branch?.condition?.kind === 'form_field' && isSyntheticBucketField(branch.condition.field)) {
        refs.push({
          stepId: step.id,
          location: `branch:${branch.id}.condition`,
          field: branch.condition.field,
        })
      }
    }
  }

  return refs
}

function repairableLegacySource(definition) {
  const legacySource = definition?.legacy?.procedureV1
  return looksLikeLegacyProcedure(legacySource) ? legacySource : null
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

function legacyStepIsRequired(step, context) {
  if (step.required === true) return true
  const caseType = asNonEmptyString(context?.caseTypeType)
  const target = asNonEmptyString(step.target)
  return REQUIRED_TOOL_OVERRIDES_BY_CASE_TYPE.get(caseType)?.has(target) === true
}

function buildActionFromLegacyStep(step, index, context) {
  const target = asNonEmptyString(step.target)
  const required = legacyStepIsRequired(step, context)
  switch (step.action) {
    case 'ask':
      return {
        id: `${step.id}_ask`,
        kind: 'ask',
        label: legacyStepTitle(step, index),
        guidance: asNonEmptyString(step.guidance),
        required,
        fields: resolveAskFields(splitFields(target, `field_${index + 1}`), [`field_${index + 1}`], {
          ...context,
          askStepFields: collectAskStepFields(step),
        }),
      }
    case 'use':
      return {
        id: `${step.id}_tool`,
        kind: 'call_tool',
        label: legacyStepTitle(step, index),
        guidance: asNonEmptyString(step.guidance),
        required,
        toolName: target || `tool_${step.id}`,
      }
    case 'read':
      if (target.startsWith('kb_search_') || target.toLowerCase().includes('knowledge')) {
        return {
          id: `${step.id}_knowledge`,
          kind: 'search_knowledge',
          label: legacyStepTitle(step, index),
          guidance: asNonEmptyString(step.guidance),
          required,
          suggestedSources: target ? [target] : [],
        }
      }
      return {
        id: `${step.id}_tool`,
        kind: 'call_tool',
        label: legacyStepTitle(step, index),
        guidance: asNonEmptyString(step.guidance),
        required,
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

function buildStepFromLegacy(step, index, context) {
  const action = buildActionFromLegacyStep(step, index, context)
  const required = legacyStepIsRequired(step, context)
  const completionGuidance =
    required && (step.action === 'use' || step.action === 'read')
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

export function migrateLegacyProcedureToV2(legacyProcedure, context = {}) {
  if (!looksLikeLegacyProcedure(legacyProcedure)) {
    throw new Error('Input is not a legacy Procedure v1 definition.')
  }
  const steps = legacyProcedure.version === 1
    ? legacyProcedure.steps.map((step, index) => buildStepFromRuntimeV1(step, index, context))
    : legacyProcedure.steps.map((step, index) => buildStepFromLegacy(step, index, context))
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

function buildActionFromRuntimeV1Tool(toolName, step, index, context) {
  switch (toolName) {
    case 'ask_user_questions':
      return {
        id: `${step.id}_ask`,
        kind: 'ask',
        label: step.title || `Ask customer (${index + 1})`,
        guidance: asNonEmptyString(step.instructions),
        required: true,
        fields: resolveAskFields(
          Array.isArray(step.requiredFacts) ? step.requiredFacts : [],
          [`field_${index + 1}`],
          {
            ...context,
            askStepFields: collectAskStepFields(step),
          },
        ),
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

function buildStepFromRuntimeV1(step, index, context) {
  const allowedTools = Array.isArray(step.allowedTools) ? step.allowedTools : []
  const hasHandoffTool = allowedTools.includes('create_human_task')
  const actions = allowedTools
    .map((toolName) => buildActionFromRuntimeV1Tool(toolName, step, index, context))
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

export function normalizeStoredProcedure(rawProcedure, context = {}) {
  const parsed = typeof rawProcedure === 'string' ? parseJsonStrict(rawProcedure) : rawProcedure
  if (!parsed) {
    return { status: 'invalid', reason: 'procedure is not valid JSON' }
  }
  if (isProcedureV2Shape(parsed)) {
    const syntheticRefs = collectSyntheticBucketReferences(parsed)
    if (syntheticRefs.length === 0) {
      return { status: 'v2', definition: parsed }
    }
    const legacySource = repairableLegacySource(parsed)
    if (legacySource) {
      return { status: 'v2_repaired', definition: migrateLegacyProcedureToV2(legacySource, context) }
    }
    return {
      status: 'invalid',
      reason: `v2 definition still contains synthetic bucket fields: ${syntheticRefs.map((ref) => ref.field).join(', ')}`,
    }
  }
  if (looksLikeLegacyProcedure(parsed)) {
    return { status: 'legacy', definition: migrateLegacyProcedureToV2(parsed, context) }
  }
  return { status: 'invalid', reason: 'procedure is neither a v2 definition nor a recognizable legacy Procedure v1 shape' }
}

export function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run')
  const inputFlagIndex = argv.indexOf('--input')
  const outputFlagIndex = argv.indexOf('--output')
  const inputPath = argv.find((arg) => arg.startsWith('--input='))?.slice('--input='.length)
    ?? (inputFlagIndex >= 0 ? argv[inputFlagIndex + 1] : undefined)
  const outputPath = argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length)
    ?? (outputFlagIndex >= 0 ? argv[outputFlagIndex + 1] : undefined)
  return {
    dryRun,
    inputPath: inputPath || null,
    outputPath: outputPath || null,
  }
}

export function extractSnapshotRows(snapshot) {
  if (Array.isArray(snapshot)) return snapshot
  if (isRecord(snapshot) && Array.isArray(snapshot.types)) return snapshot.types
  if (isRecord(snapshot) && isRecord(snapshot.data) && Array.isArray(snapshot.data.types)) return snapshot.data.types
  throw new Error('Snapshot input must be an array of case types or an envelope containing data.types.')
}

function serializeProcedure(definition, originalProcedure) {
  return typeof originalProcedure === 'string' ? JSON.stringify(definition) : definition
}

export function migrateCaseTypeRows(rows) {
  const summary = {
    scanned: rows.length,
    migrated: 0,
    alreadyV2: 0,
    repairedV2: 0,
    invalid: 0,
    failures: [],
    results: [],
  }

  const normalizedRows = rows.map((row, index) => {
    const rowId = row?.id ?? `row_${index + 1}`
    const rowType = row?.type ?? `row_${index + 1}`
    let normalized
    try {
      normalized = normalizeStoredProcedure(row?.procedure, {
        caseTypeRequiredFacts: parseStringArray(row?.requiredFacts),
        caseTypeType: rowType,
      })
    } catch (error) {
      summary.invalid += 1
      const reason = error instanceof Error ? error.message : 'unknown migration failure'
      summary.failures.push({ id: rowId, type: rowType, reason })
      summary.results.push({ id: rowId, type: rowType, status: 'invalid', reason })
      return row
    }
    if (normalized.status === 'v2') {
      const syntheticRefs = collectSyntheticBucketReferences(normalized.definition)
      if (syntheticRefs.length > 0) {
        summary.invalid += 1
        const reason = `v2 definition still contains synthetic bucket fields: ${syntheticRefs.map((ref) => ref.field).join(', ')}`
        summary.failures.push({ id: rowId, type: rowType, reason })
        summary.results.push({ id: rowId, type: rowType, status: 'invalid', reason })
        return row
      }
      summary.alreadyV2 += 1
      summary.results.push({ id: rowId, type: rowType, status: 'v2' })
      return row
    }
    if (normalized.status === 'invalid') {
      summary.invalid += 1
      summary.failures.push({ id: rowId, type: rowType, reason: normalized.reason })
      summary.results.push({ id: rowId, type: rowType, status: 'invalid', reason: normalized.reason })
      return row
    }

    if (normalized.status === 'v2_repaired') {
      summary.repairedV2 += 1
      summary.results.push({ id: rowId, type: rowType, status: 'v2_repaired' })
    } else {
      summary.migrated += 1
      summary.results.push({ id: rowId, type: rowType, status: 'legacy_migrated' })
    }
    return {
      ...row,
      procedure: serializeProcedure(normalized.definition, row?.procedure),
    }
  })

  return { summary, normalizedRows }
}

async function runSnapshotMode({ dryRun, inputPath, outputPath }) {
  const raw = await readFile(inputPath, 'utf8')
  const parsed = JSON.parse(raw)
  const rows = extractSnapshotRows(parsed)
  const { summary, normalizedRows } = migrateCaseTypeRows(rows)
  const nextSnapshot = Array.isArray(parsed)
    ? normalizedRows
    : isRecord(parsed) && Array.isArray(parsed.types)
      ? { ...parsed, types: normalizedRows }
      : { ...parsed, data: { ...parsed.data, types: normalizedRows } }

  if (outputPath) {
    await writeFile(outputPath, JSON.stringify(nextSnapshot, null, 2))
  }

  const result = {
    source: 'snapshot',
    dryRun,
    inputPath,
    outputPath: outputPath || null,
    ...summary,
  }
  console.log(JSON.stringify(result, null, 2))
  if (summary.invalid > 0) process.exitCode = 1
}

async function runDatabaseMode({ dryRun }) {
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.caseType.findMany({
      where: { NOT: { procedure: null } },
      select: { id: true, type: true, requiredFacts: true, procedure: true },
      orderBy: { type: 'asc' },
    })

    const { summary, normalizedRows } = migrateCaseTypeRows(rows)

    for (let index = 0; index < rows.length; index += 1) {
      const original = rows[index]
      const next = normalizedRows[index]
      if (original === next) continue
      if (!dryRun) {
        await prisma.caseType.update({
          where: { id: original.id },
          data: { procedure: next.procedure },
        })
      }
    }

    const result = {
      source: 'database',
      dryRun,
      ...summary,
    }
    console.log(JSON.stringify(result, null, 2))
    if (summary.invalid > 0) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2))
  if (options.inputPath) {
    await runSnapshotMode(options)
    return
  }
  await runDatabaseMode(options)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((error) => {
    console.error('[migrate-procedures-v1-to-v2] failed')
    console.error(error)
    process.exit(1)
  })
}
