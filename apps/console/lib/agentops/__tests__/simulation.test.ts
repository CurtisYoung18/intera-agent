import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentOpsSimulationRequestSchema } from '@intera/shared/contracts/agentops/simulation'
import type { SSEEvent } from '@intera/shared/types'

const h = vi.hoisted(() => ({
  runPlaygroundTurn: vi.fn(),
}))

vi.mock('@/lib/agent/playground-runner', () => ({
  runPlaygroundTurn: h.runPlaygroundTurn,
}))

import { runAgentOpsSimulation } from '../simulation'

beforeEach(() => {
  h.runPlaygroundTurn.mockReset()
})

describe('runAgentOpsSimulation', () => {
  it('runs multi-turn scripts through the local Playground dry-run path', async () => {
    h.runPlaygroundTurn.mockImplementation((input: { chatId?: string }) => {
      const turnIndex = h.runPlaygroundTurn.mock.calls.length - 1
      return streamEvents([
        event('session_init', { chatId: input.chatId ?? 'chat-sim-1', caseId: 'case-sim-1' }),
        event('tool_executing', {
          name: 'get_latest_deposit',
          input: { memberId: '12345' },
          executionTruth: { effectiveMode: 'mocked_dry_run' },
        }),
        event('tool_result', {
          name: 'get_latest_deposit',
          result: {
            output: { _dryRun: true, status: 'mocked' },
            executionTruth: { effectiveMode: 'mocked_dry_run' },
          },
        }),
        event('text_delta', turnIndex === 0 ? 'Please share your member id.' : 'I will hand this to support.'),
        event('trace', {
          turnId: `turn-${turnIndex + 1}`,
          caseType: 'deposit_issue',
          blocked: false,
          totalMs: 12,
          rawTrace: [],
        }),
        event('message_stop', { transition: 'next_turn' }),
      ])
    })

    const receipt = await runAgentOpsSimulation({
      orgId: 'org-1',
      agentId: 'agent-active',
      simulationId: 'sim_test',
      now: new Date('2026-06-29T00:00:00.000Z'),
      request: AgentOpsSimulationRequestSchema.parse({
        mode: 'local_runtime',
        toolPolicy: 'mocked',
        draftAgentConfigId: 'agent-draft',
        source: {
          type: 'turn_script',
          name: 'deposit_followup',
          turns: [
            { role: 'user', content: 'My deposit is missing.' },
            { role: 'user', content: 'member id is 12345.' },
          ],
        },
      }),
    })

    expect(h.runPlaygroundTurn).toHaveBeenCalledTimes(2)
    expect(h.runPlaygroundTurn.mock.calls[0][0]).toMatchObject({
      orgId: 'org-1',
      configId: 'agent-draft',
      message: 'My deposit is missing.',
      userId: 'agentops-sim:sim_test',
      playgroundConfig: {
        debug: true,
        toolExecutionMode: 'dry_run',
      },
    })
    expect(h.runPlaygroundTurn.mock.calls[1][0]).toMatchObject({
      chatId: 'chat-sim-1',
      message: 'member id is 12345.',
    })
    expect(receipt.status).toBe('pass')
    expect(receipt.mode).toBe('local_runtime')
    expect(receipt.toolPolicy).toBe('mocked')
    expect(receipt.session).toMatchObject({
      chatId: 'chat-sim-1',
      caseId: 'case-sim-1',
      turnCount: 2,
    })
    expect(receipt.safety).toMatchObject({
      providerCalls: true,
      externalToolCalls: false,
      runtimeToolExecution: false,
      businessSideEffects: false,
      localPersistenceWrites: true,
      productionRuntimeSimulation: false,
      scenarioReceiptsAppended: false,
      scenarioValidationMarkedValidated: false,
    })
    expect(receipt.turns).toHaveLength(2)
    expect(receipt.turns[0]?.toolCalls[0]).toMatchObject({
      name: 'get_latest_deposit',
      executionMode: 'mocked',
    })
    expect(receipt.turns[0]?.toolResults[0]).toMatchObject({
      name: 'get_latest_deposit',
      executionMode: 'mocked',
      errored: false,
    })
  })
})

async function* streamEvents(events: SSEEvent[]): AsyncGenerator<SSEEvent> {
  for (const item of events) yield item
}

function event(type: string, data: unknown): SSEEvent {
  return {
    type,
    data,
    timestamp: '2026-06-29T00:00:00.000Z',
  } as SSEEvent
}
