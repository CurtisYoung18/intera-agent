import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  scenarioReceiptSchema,
  scenarioValidationStateSchema,
  templateScenarioSchema,
  type SavedScenario,
  type ScenarioCreateRequest,
  type ScenarioReceipt,
  type ScenarioUpdateRequest,
  type ScenarioValidationState,
} from '@intera/shared/contracts/scenarios'

interface AgentScenarioBucket {
  validationState: ScenarioValidationState
  changedAt?: string
  lastValidatedAt?: string
  lastReceiptId?: string
  lastReceiptStatus?: ScenarioReceipt['status']
  scenarios: Record<string, SavedScenario>
  receipts: ScenarioReceipt[]
}

interface ScenarioStoreFile {
  version: 1
  agents: Record<string, AgentScenarioBucket>
}

let writeQueue = Promise.resolve()

export function scenarioStorePath(): string {
  return process.env.INTERA_SCENARIO_STORE_PATH
    || path.join(process.cwd(), '.intera-agent-runtime', 'scenarios.json')
}

function emptyBucket(): AgentScenarioBucket {
  return {
    validationState: 'Not validated',
    scenarios: {},
    receipts: [],
  }
}

function initialStore(): ScenarioStoreFile {
  return { version: 1, agents: {} }
}

async function readStore(): Promise<ScenarioStoreFile> {
  const file = scenarioStorePath()
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as ScenarioStoreFile
    if (parsed.version !== 1 || !parsed.agents || typeof parsed.agents !== 'object') {
      return initialStore()
    }
    return parsed
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return initialStore()
    throw err
  }
}

async function writeStore(store: ScenarioStoreFile): Promise<void> {
  const file = scenarioStorePath()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

async function updateStore<T>(mutate: (store: ScenarioStoreFile) => T | Promise<T>): Promise<T> {
  const next = writeQueue.then(async () => {
    const store = await readStore()
    const result = await mutate(store)
    await writeStore(store)
    return result
  })
  writeQueue = next.then(() => undefined, () => undefined)
  return next
}

function bucketFor(store: ScenarioStoreFile, agentConfigId: string): AgentScenarioBucket {
  const existing = store.agents[agentConfigId]
  if (existing) {
    existing.validationState = scenarioValidationStateSchema.parse(existing.validationState)
    existing.scenarios ??= {}
    existing.receipts ??= []
    return existing
  }
  const created = emptyBucket()
  store.agents[agentConfigId] = created
  return created
}

function sortedScenarios(bucket: AgentScenarioBucket): SavedScenario[] {
  return Object.values(bucket.scenarios).sort((a, b) => a.name.localeCompare(b.name))
}

export async function listScenarios(agentConfigId: string): Promise<{
  scenarios: SavedScenario[]
  validationState: AgentScenarioBucket['validationState']
  changedAt?: string
  lastValidatedAt?: string
  lastReceiptId?: string
  lastReceiptStatus?: ScenarioReceipt['status']
  receipts: ScenarioReceipt[]
}> {
  const store = await readStore()
  const bucket = store.agents[agentConfigId] ?? emptyBucket()
  return {
    scenarios: sortedScenarios(bucket),
    validationState: bucket.validationState,
    changedAt: bucket.changedAt,
    lastValidatedAt: bucket.lastValidatedAt,
    lastReceiptId: bucket.lastReceiptId,
    lastReceiptStatus: bucket.lastReceiptStatus,
    receipts: [...bucket.receipts].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  }
}

export async function getScenario(agentConfigId: string, name: string): Promise<SavedScenario | null> {
  const store = await readStore()
  return store.agents[agentConfigId]?.scenarios[name] ?? null
}

export async function saveScenario(
  agentConfigId: string,
  input: ScenarioCreateRequest,
): Promise<SavedScenario> {
  const parsed = templateScenarioSchema.parse(input)
  return updateStore((store) => {
    const bucket = bucketFor(store, agentConfigId)
    const now = new Date().toISOString()
    const existing = bucket.scenarios[parsed.name]
    const scenario: SavedScenario = {
      ...parsed,
      id: existing?.id ?? randomUUID(),
      agentConfigId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastRunId: existing?.lastRunId,
      lastRunStatus: existing?.lastRunStatus,
    }
    bucket.scenarios[parsed.name] = scenario
    markBucketChanged(bucket, now)
    return scenario
  })
}

export async function updateScenario(
  agentConfigId: string,
  currentName: string,
  input: ScenarioUpdateRequest,
): Promise<SavedScenario | null> {
  return updateStore((store) => {
    const bucket = bucketFor(store, agentConfigId)
    const existing = bucket.scenarios[currentName]
    if (!existing) return null
    const merged = templateScenarioSchema.parse({
      name: input.name ?? existing.name,
      displayName: input.displayName ?? existing.displayName,
      description: input.description ?? existing.description,
      locale: input.locale ?? existing.locale,
      tags: input.tags ?? existing.tags,
      turns: input.turns ?? existing.turns,
      expected: input.expected ?? existing.expected,
      enabled: input.enabled ?? existing.enabled,
    })
    const now = new Date().toISOString()
    if (merged.name !== currentName) delete bucket.scenarios[currentName]
    const updated: SavedScenario = {
      ...merged,
      id: existing.id,
      agentConfigId,
      createdAt: existing.createdAt,
      updatedAt: now,
      lastRunId: existing.lastRunId,
      lastRunStatus: existing.lastRunStatus,
    }
    bucket.scenarios[merged.name] = updated
    markBucketChanged(bucket, now)
    return updated
  })
}

export async function deleteScenario(agentConfigId: string, name: string): Promise<boolean> {
  return updateStore((store) => {
    const bucket = bucketFor(store, agentConfigId)
    if (!bucket.scenarios[name]) return false
    delete bucket.scenarios[name]
    markBucketChanged(bucket, new Date().toISOString())
    return true
  })
}

export async function appendScenarioReceipt(
  agentConfigId: string,
  receipt: ScenarioReceipt,
): Promise<ScenarioReceipt> {
  const parsed = scenarioReceiptSchema.parse(receipt)
  return updateStore((store) => {
    const bucket = bucketFor(store, agentConfigId)
    bucket.receipts.unshift(parsed)
    bucket.receipts = bucket.receipts.slice(0, 50)
    bucket.lastReceiptId = parsed.runId
    bucket.lastReceiptStatus = parsed.status
    if (parsed.status === 'passed') {
      bucket.validationState = 'Validated'
      bucket.lastValidatedAt = parsed.finishedAt ?? parsed.startedAt
    } else {
      bucket.validationState = 'Validation failed'
    }
    const scenario = bucket.scenarios[parsed.scenarioName]
    if (scenario) {
      scenario.lastRunId = parsed.runId
      scenario.lastRunStatus = parsed.status
      scenario.updatedAt = scenario.updatedAt || new Date().toISOString()
    }
    return parsed
  })
}

export async function markScenarioValidationChanged(
  agentConfigIds: string[],
  at = new Date().toISOString(),
): Promise<void> {
  const ids = [...new Set(agentConfigIds.filter(Boolean))]
  if (ids.length === 0) return
  await updateStore((store) => {
    for (const id of ids) markBucketChanged(bucketFor(store, id), at)
  })
}

export async function getScenarioValidationSummary(agentConfigId: string): Promise<{
  state: ScenarioValidationState
  changedAt?: string
  lastValidatedAt?: string
  lastReceiptId?: string
  lastReceiptStatus?: ScenarioReceipt['status']
  overrideRequired: boolean
}> {
  const store = await readStore()
  const bucket = store.agents[agentConfigId] ?? emptyBucket()
  return {
    state: bucket.validationState,
    changedAt: bucket.changedAt,
    lastValidatedAt: bucket.lastValidatedAt,
    lastReceiptId: bucket.lastReceiptId,
    lastReceiptStatus: bucket.lastReceiptStatus,
    overrideRequired: bucket.validationState !== 'Validated',
  }
}

function markBucketChanged(bucket: AgentScenarioBucket, at: string): void {
  bucket.validationState = 'Changed since last validation'
  bucket.changedAt = at
}
