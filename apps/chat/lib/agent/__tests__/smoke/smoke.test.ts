import { describe, it, expect } from 'vitest'
import { mockTextStream, mockToolUseStream, createMockStream, mockStreamThatBreaks } from '../mocks/anthropic'
import { consumeStream, type StreamConsumeCallbacks, type StreamContentBlock } from '../../stream-handler'
import { SkillRouter } from '../../skills'
import { classifyError } from '../../api/error-classifier'
import { synthesizeMissingToolResults, assertToolResultInvariant } from '../../tool-result-invariant'
import { APIConnectionError, APIUserAbortError } from '@anthropic-ai/sdk'
import type { ToolUse } from '@intera/shared/types'

function makeToolUse(id: string, name: string): ToolUse {
  return { id, name, input: {} }
}

describe('Smoke — Stream Handler (E1-1)', () => {
  it('text stream produces accumulated text', async () => {
    const stream = mockTextStream('Hello, how can I help?')
    const blocks = new Map<number, StreamContentBlock>()
    const cbs: StreamConsumeCallbacks = {
      sendEvent: () => {},
      sanitizeChunk: (t) => t,
      flushSanitizer: () => '',
      recordFirstToken: () => {},
      showThinking: false,
      onToolUseCompleted: () => Promise.resolve(),
    }

    const result = await consumeStream(stream as any, blocks, cbs)
    expect(result.fullText).toBe('Hello, how can I help?')
    expect(result.stopReason).toBe('end_turn')
  })

  it('tool_use stream triggers onToolUseCompleted', async () => {
    const stream = mockToolUseStream('dispatch_case_agent', { caseType: 'withdrawal_issue' })
    const blocks = new Map<number, StreamContentBlock>()
    let toolCalled = false
    let toolName = ''

    const cbs: StreamConsumeCallbacks = {
      sendEvent: () => {},
      sanitizeChunk: (t) => t,
      flushSanitizer: () => '',
      recordFirstToken: () => {},
      showThinking: false,
      onToolUseCompleted: async (tu) => {
        toolCalled = true
        toolName = tu.name
      },
    }

    await consumeStream(stream as any, blocks, cbs)
    expect(toolCalled).toBe(true)
    expect(toolName).toBe('dispatch_case_agent')
  })
})

describe('Smoke — SkillRouter (E1-2)', () => {
  it('returns built-in skills including dispatch_subagent', () => {
    const router = new SkillRouter('smoke-test')
    const skills = router.getToolDefinitions()
    expect(skills.length).toBeGreaterThan(0)

    const dispatchCaseAgent = router.getSkill('dispatch_case_agent')
    expect(dispatchCaseAgent).toBeDefined()

    const finalizeCase = router.getSkill('finalize_case')
    expect(finalizeCase).toBeDefined()

    const dispatchSubagent = router.getSkill('dispatch_subagent')
    expect(dispatchSubagent).toBeDefined()
  })

  it('getSkill returns undefined for unknown skill', () => {
    const router = new SkillRouter('smoke-test')
    expect(router.getSkill('nonexistent_skill_xyz')).toBeUndefined()
  })
})

describe('Smoke — S1 Invariant (E1-3)', () => {
  it('synthesis produces results for all tool_uses', () => {
    const toolUses = [makeToolUse('a', 'read'), makeToolUse('b', 'write')]
    const completedResults = [
      { toolUseId: 'a', output: { ok: true }, isError: false },
      { toolUseId: 'b', output: { ok: true }, isError: false },
    ]
    const missingReasons = new Map()

    const blocks = synthesizeMissingToolResults({ toolUses, completedResults, missingReasons })
    expect(blocks).toHaveLength(2)
    expect(blocks.every(b => !b.is_error)).toBe(true)
  })

  it('assertToolResultInvariant passes for valid message pairs', () => {
    const messages = [
      { role: 'assistant', content: '', toolUses: [makeToolUse('a', 'test')] },
      { role: 'user', content: [{ tool_use_id: 'a', type: 'tool_result' }] },
    ]
    expect(() => assertToolResultInvariant(messages)).not.toThrow()
  })

  it('assertToolResultInvariant throws for unmatched tool_use', () => {
    const messages = [
      { role: 'assistant', content: '', toolUses: [makeToolUse('a', 'orphan')] },
    ]
    expect(() => assertToolResultInvariant(messages)).toThrow(/unmatched/)
  })
})

describe('Smoke — Error Classifier (E1-4)', () => {
  it('classifies connection error as transient_network', () => {
    expect(classifyError(new APIConnectionError({ message: 'ECONNRESET' } as any))).toBe('transient_network')
  })

  it('classifies abort error', () => {
    expect(classifyError(new APIUserAbortError())).toBe('aborted')
  })
})
