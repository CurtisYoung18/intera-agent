import type {
  ConfigPilotContextResponse,
  ConfigPilotDiffGroup,
  ConfigPilotDiffItem,
  ConfigPilotPatch,
  ConfigPilotProposal,
  ConfigPilotSurface,
} from './contracts'

const GROUP_COPY: Record<ConfigPilotSurface, { title: string; description: string }> = {
  brain: { title: 'Brain', description: 'Model, prompt, memory, and Agent-level reasoning settings.' },
  procedures: { title: 'Procedures', description: 'Procedure types and ordered Procedure steps.' },
  tools: { title: 'Tools', description: 'Agent-callable business Tools.' },
  hooks: { title: 'Hooks', description: 'PreToolUse, PostToolUse, and Stop control rules.' },
  hookBindings: { title: 'Hook bindings', description: 'Activation scopes that bind Hooks to Agent, Procedure, step, or Tool contexts.' },
  knowledge: { title: 'Knowledge', description: 'Knowledge source references and retrieval controls.' },
  integrations: { title: 'Integrations', description: 'Channel bindings and non-secret integration refs.' },
  scenarios: { title: 'Scenarios', description: 'Pilot Lab validation cases and receipt expectations.' },
}

type AnyRecord = Record<string, any>

function asText(value: unknown): string {
  if (value === undefined) return 'Not changed'
  if (value === null) return 'None'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

function item(key: string, label: string, before: unknown, after: unknown, detail?: string): ConfigPilotDiffItem {
  const beforeText = before === undefined ? undefined : asText(before)
  const afterText = after === undefined ? undefined : asText(after)
  const status = before === undefined ? 'added' : after === undefined ? 'removed' : beforeText === afterText ? 'unchanged' : 'changed'
  return { key, label, detail, status, before: beforeText, after: afterText }
}

function findByName(rows: unknown, key: string, value: string): AnyRecord | undefined {
  if (!Array.isArray(rows)) return undefined
  return rows.find((row) => row && typeof row === 'object' && String((row as AnyRecord)[key]) === value) as AnyRecord | undefined
}

function valuesFromPatch(patch: ConfigPilotPatch): Record<string, unknown> {
  if ('fields' in patch && patch.fields) return patch.fields as Record<string, unknown>
  if ('value' in patch && patch.value) return patch.value as Record<string, unknown>
  return {}
}

function beforeRecord(context: ConfigPilotContextResponse, patch: ConfigPilotPatch): AnyRecord | undefined {
  if (patch.surface === 'brain') return context.configuration.brain as AnyRecord | undefined
  if (patch.surface === 'procedures') {
    const type = patch.operation === 'update' ? patch.target.type : patch.value.type
    return findByName(context.configuration.procedures, 'type', type)
  }
  if (patch.surface === 'tools') {
    const name = patch.operation === 'update' ? patch.target.name : patch.value.name
    return findByName(context.configuration.tools, 'name', name)
  }
  if (patch.surface === 'hooks') {
    const name = patch.operation === 'update' ? patch.target.name : patch.value.name
    return findByName(context.configuration.hooks, 'name', name)
  }
  if (patch.surface === 'knowledge') {
    const name = patch.operation === 'update' ? patch.target.name : patch.value.name
    return findByName(context.configuration.knowledge, 'name', name)
  }
  if (patch.surface === 'integrations') {
    return findByName(context.configuration.integrations, 'channel', patch.target.channel)
  }
  if (patch.surface === 'scenarios') {
    const name = patch.operation === 'update' ? patch.target.name : patch.value.name
    return findByName(context.configuration.scenarios, 'name', name)
  }
  return undefined
}

function patchTarget(patch: ConfigPilotPatch): string {
  if (patch.surface === 'brain') return 'Agent Brain'
  if (patch.surface === 'procedures') return patch.operation === 'update' ? patch.target.type : patch.value.type
  if (patch.surface === 'tools') return patch.operation === 'update' ? patch.target.name : patch.value.name
  if (patch.surface === 'hooks') return patch.operation === 'update' ? patch.target.name : patch.value.name
  if (patch.surface === 'hookBindings') return `${patch.value.hookName} -> ${patch.value.scopeType}`
  if (patch.surface === 'knowledge') return patch.operation === 'update' ? patch.target.name : patch.value.name
  if (patch.surface === 'integrations') return patch.target.channel
  return patch.operation === 'update' ? patch.target.name : patch.value.name
}

function diffItemsForPatch(context: ConfigPilotContextResponse, patch: ConfigPilotPatch): ConfigPilotDiffItem[] {
  if (patch.surface === 'hookBindings') {
    return [
      item(`${patchTarget(patch)}.scope`, 'Binding scope', undefined, patch.value.scopeType, patchTarget(patch)),
      item(`${patchTarget(patch)}.target`, 'Binding target', undefined, {
        caseTypeType: patch.value.caseTypeType,
        procedureStepId: patch.value.procedureStepId,
        toolName: patch.value.toolName,
      }, 'Resolved to internal ids only inside apply.'),
    ]
  }

  const before = beforeRecord(context, patch)
  const values = valuesFromPatch(patch)
  const target = patchTarget(patch)
  const keys = Object.keys(values)
  if (keys.length === 0) {
    return [item(`${target}.operation`, 'Operation', before ? 'Existing' : undefined, patch.operation)]
  }
  return keys.map((key) => item(`${target}.${key}`, `${target} / ${key}`, before?.[key], values[key]))
}

export function buildProposalDiffGroups(
  context: ConfigPilotContextResponse,
  proposal: Pick<ConfigPilotProposal, 'patches'>,
): ConfigPilotDiffGroup[] {
  const bySurface = new Map<ConfigPilotSurface, ConfigPilotDiffItem[]>()

  for (const patch of proposal.patches) {
    const existing = bySurface.get(patch.surface) ?? []
    existing.push(...diffItemsForPatch(context, patch))
    bySurface.set(patch.surface, existing)
  }

  return [...bySurface.entries()].map(([surface, items]) => {
    const copy = GROUP_COPY[surface]
    const material = items.filter((row) => row.status !== 'unchanged').length
    return {
      id: surface,
      title: copy.title,
      description: copy.description,
      summary: material > 0 ? `${material} proposed ${material === 1 ? 'change' : 'changes'}` : 'No material changes',
      items,
    }
  })
}
