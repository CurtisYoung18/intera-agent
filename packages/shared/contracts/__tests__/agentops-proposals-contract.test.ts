import { describe, expect, it } from 'vitest'
import { configPilotProposalSchema } from '@/lib/config-pilot/contracts'
import { makeAgentOpsProposalCreateRequestSchema } from '../agentops/proposals'

const schema = makeAgentOpsProposalCreateRequestSchema(configPilotProposalSchema)
const fingerprint = 'a'.repeat(64)

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    targetSurface: 'brain',
    title: 'Tighten prompt',
    summary: 'Lower temperature for evidence-sensitive turns.',
    patches: [{
      surface: 'brain',
      operation: 'update',
      fields: { temperature: 0.2 },
    }],
    diffGroups: [],
    receiptSuggestions: [],
    runSuggestions: [],
    safetyNotes: [],
    ...overrides,
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'agentops.proposal-create.v1',
    target: { agentId: 'agent-1' },
    baseDraftFingerprint: fingerprint,
    externalAgent: {
      name: 'Codex Worker P-intake',
      runId: 'worker-p-intake-1',
    },
    reason: 'GMT mismatch found in scoped evidence.',
    evidenceRefs: ['chat:chat-1', 'forensic-pack:chat-1'],
    proposal: proposal({ baseDraftFingerprint: fingerprint }),
    ...overrides,
  }
}

describe('AgentOps proposal create contract', () => {
  it('accepts a ConfigPilot proposal with refs-only evidence', () => {
    const parsed = schema.parse(request())

    expect(parsed.schemaVersion).toBe('agentops.proposal-create.v1')
    expect(parsed.evidenceRefs).toEqual(['chat:chat-1', 'forensic-pack:chat-1'])
    expect(parsed.proposal.patches).toHaveLength(1)
  })

  it('accepts the required AgentOps fields without optional target context', () => {
    const { target: _target, ...body } = request()
    const parsed = schema.parse(body)

    expect(parsed.target).toBeUndefined()
    expect(parsed.baseDraftFingerprint).toBe(fingerprint)
  })

  it('rejects invalid schema versions', () => {
    const parsed = schema.safeParse(request({ schemaVersion: 'agentops.proposal-create.v2' }))

    expect(parsed.success).toBe(false)
  })

  it('rejects empty evidence refs', () => {
    const parsed = schema.safeParse(request({ evidenceRefs: [] }))

    expect(parsed.success).toBe(false)
  })

  it('rejects oversized, raw-looking, or secret-like evidence payloads', () => {
    const stripeLikeSecret = ['sk', 'live', '1234567890'].join('_')
    const badEvidenceRefs = [
      `chat:${'x'.repeat(170)}`,
      'debug:{"messages":[{"content":"raw"}]}',
      `trace:api_key=${stripeLikeSecret}`,
      `trace:${'a'.repeat(100)}`,
    ]

    for (const evidenceRef of badEvidenceRefs) {
      expect(schema.safeParse(request({ evidenceRefs: [evidenceRef] })).success).toBe(false)
    }
  })

  it('rejects secret-like values in persisted reason metadata', () => {
    const parsed = schema.safeParse(request({
      reason: 'Found drift while reading DATABASE_URL=postgresql://user:pass@host/db',
    }))

    expect(parsed.success).toBe(false)
  })

  it('requires proposal fingerprint context to match the request fingerprint', () => {
    const parsed = schema.safeParse(request({
      proposal: proposal({ baseDraftFingerprint: 'b'.repeat(64) }),
    }))

    expect(parsed.success).toBe(false)
  })

  it('rejects activation-style patch keys through ConfigPilot proposal composition', () => {
    for (const key of ['isActive', 'publish', 'activate', 'deploy', 'rollback']) {
      const parsed = schema.safeParse(request({
        proposal: proposal({
          baseDraftFingerprint: fingerprint,
          patches: [{
            surface: 'brain',
            operation: 'update',
            fields: { [key]: true },
          }],
        }),
      }))

      expect(parsed.success).toBe(false)
    }
  })
})
