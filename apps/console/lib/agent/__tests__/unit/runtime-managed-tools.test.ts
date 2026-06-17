import { describe, expect, it } from 'vitest'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { ChatMemoryManager } from '../../memory'
import { createMemoryPersistence } from '../../persistence-port'
import { TraceWriter } from '../../trace'
import {
  RuntimeManagedToolResolver,
  shouldPersistToolResultToChatMemory,
  shouldRecordProcedureEvidence,
} from '../../runtime-managed-tools'
import { makeDefaultConfig } from '../factories/agent-loop'
import type { ToolExecutionResult } from '../../streaming-tool-executor'

describe('runtime-managed-tools', () => {
  it('keeps runtime-managed tool outputs out of ordinary memory and evidence recording', () => {
    expect(shouldPersistToolResultToChatMemory('read_chat_memory')).toBe(false)
    expect(shouldPersistToolResultToChatMemory('read_user_profile')).toBe(false)
    expect(shouldPersistToolResultToChatMemory('remember')).toBe(false)
    expect(shouldPersistToolResultToChatMemory('finalize_procedure')).toBe(false)
    expect(shouldPersistToolResultToChatMemory('get_latest_deposit')).toBe(true)

    expect(shouldRecordProcedureEvidence('read_chat_memory')).toBe(false)
    expect(shouldRecordProcedureEvidence('remember')).toBe(false)
    expect(shouldRecordProcedureEvidence('finalize_procedure')).toBe(true)
    expect(shouldRecordProcedureEvidence('create_human_task')).toBe(true)
  })

  it('resolves read_chat_memory into a runtime-managed tool output', async () => {
    const chatMemory = new ChatMemoryManager('case-1', DEFAULT_MEMORY_STRATEGY)
    chatMemory.loadFromDb({
      toolsCalled: JSON.stringify(['get_latest_deposit']),
      keyEvents: JSON.stringify([{ at: '2026-06-12T00:00:00.000Z', text: 'Deposit checked', source: 'tool' }]),
      missingFacts: JSON.stringify(['member_id']),
      summary: 'Customer asked about deposit status.',
      todos: JSON.stringify([{ id: 'todo-1', text: 'Follow up', status: 'open' }]),
    })

    const { port } = createMemoryPersistence()
    const result: ToolExecutionResult = {
      name: 'read_chat_memory',
      output: { ok: true, output: 'placeholder', latencyMs: 1 },
      latencyMs: 1,
      toolUse: { id: 'toolu_memory', name: 'read_chat_memory', input: {} },
    }

    await new RuntimeManagedToolResolver({
      caseId: 'case-1',
      orgId: 'org-1',
      userId: 'user-1',
      chatId: 'chat-1',
      configId: 'agent-1',
      config: makeDefaultConfig(),
      caseSchema: null,
      messages: [],
      chatMemory,
      persistence: port,
      traceWriter: new TraceWriter('case-1', port),
      dryRun: true,
      canCreateHumanTaskInGeneralMode: false,
    }).resolve([result], new Map([['toolu_memory', 1]]), 1)

    expect(result.toolUse?.status).toBe('completed')
    expect(result.output).toMatchObject({
      ok: true,
      output: {
        scope: 'chat',
        authority: 'context_only_not_procedure_run_state',
        toolsCalled: ['get_latest_deposit'],
        compactSummary: 'Customer asked about deposit status.',
        openItems: [{ id: 'todo-1', text: 'Follow up', status: 'open' }],
        stats: {
          missingFacts: ['member_id'],
          toolCount: 1,
          keyEventCount: 1,
        },
      },
      latencyMs: 1,
    })
  })
})
