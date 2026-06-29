import { describe, expect, it } from 'vitest'
import {
  AgentOpsSimulationReceiptSchema,
  AgentOpsSimulationRequestSchema,
} from '../agentops/simulation'

const baseRequest = {
  mode: 'local_runtime',
  toolPolicy: 'mocked',
  draftAgentConfigId: 'agent_default_v2',
  source: {
    type: 'turn_script',
    name: 'deposit_followup',
    turns: [
      { role: 'user', content: 'My deposit is missing.' },
      { role: 'user', content: 'member id is 12345.' },
    ],
  },
  options: { emitThinking: false },
} as const

describe('AgentOpsSimulationRequestSchema', () => {
  it('accepts local runtime simulations with mocked tool policy', () => {
    const parsed = AgentOpsSimulationRequestSchema.parse(baseRequest)

    expect(parsed.mode).toBe('local_runtime')
    expect(parsed.toolPolicy).toBe('mocked')
    expect(parsed.source.type).toBe('turn_script')
  })

  it('defaults mocked tool policy and options', () => {
    const parsed = AgentOpsSimulationRequestSchema.parse({
      mode: 'local_runtime',
      source: {
        type: 'turn_script',
        turns: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(parsed.toolPolicy).toBe('mocked')
    expect(parsed.options.emitThinking).toBe(false)
  })

  it('rejects production-like or unsupported modes', () => {
    expect(() => AgentOpsSimulationRequestSchema.parse({
      ...baseRequest,
      mode: 'production_runtime',
    })).toThrow()
    expect(() => AgentOpsSimulationRequestSchema.parse({
      ...baseRequest,
      toolPolicy: 'read_only_live',
    })).toThrow()
  })

  it('rejects assistant-authored turn scripts for this MVP', () => {
    expect(() => AgentOpsSimulationRequestSchema.parse({
      ...baseRequest,
      source: {
        type: 'turn_script',
        turns: [{ role: 'assistant', content: 'I can help.' }],
      },
    })).toThrow()
  })
})

describe('AgentOpsSimulationReceiptSchema', () => {
  it('requires the receipt to expose safety posture explicitly', () => {
    const receipt = AgentOpsSimulationReceiptSchema.parse({
      schemaVersion: 'agentops.simulation-receipt.v1',
      simulationId: 'sim_test',
      generatedAt: '2026-06-29T00:00:00.000Z',
      status: 'pass',
      mode: 'local_runtime',
      toolPolicy: 'mocked',
      agentId: 'agent-a',
      draftAgentConfigId: 'draft-a',
      source: { type: 'turn_script', name: 'deposit_followup' },
      safety: {
        providerCalls: true,
        externalToolCalls: false,
        runtimeToolExecution: false,
        businessSideEffects: false,
        localPersistenceWrites: true,
        productionRuntimeSimulation: false,
        scenarioReceiptsAppended: false,
        scenarioValidationMarkedValidated: false,
        reason: 'local dry-run',
      },
      session: {
        userId: 'agentops-sim:sim_test',
        turnCount: 1,
      },
      turns: [{
        index: 0,
        userInput: 'Hello',
        assistantResponse: 'Hi',
        blocked: false,
        eventCounts: { text_delta: 1 },
        toolCalls: [],
        toolResults: [],
        warnings: [],
      }],
      finalEvidence: {
        finalResponse: 'Hi',
      },
      warnings: [],
    })

    expect(receipt.safety.productionRuntimeSimulation).toBe(false)
    expect(receipt.safety.runtimeToolExecution).toBe(false)
  })
})
