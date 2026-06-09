import { describe, it, expect } from 'vitest'
import {
  synthesizeMissingToolResults,
  assertToolResultInvariant,
  type ToolResultBlock,
  type SynthesisReason,
} from '../../tool-result-invariant'
import type { ToolUse } from '@intera/shared/types'

function makeToolUse(id: string, name: string): ToolUse {
  return { id, name, input: {} }
}

function makeResult(toolUseId: string, output: unknown, isError = false) {
  return { toolUseId, output, isError }
}

describe('synthesizeMissingToolResults', () => {
  it('returns actual results when all tool_uses have matching completedResults', () => {
    const toolUses = [makeToolUse('a', 'read'), makeToolUse('b', 'write')]
    const completedResults = [
      makeResult('a', { ok: true }),
      makeResult('b', { ok: true }),
    ]
    const missingReasons = new Map<string, SynthesisReason>()

    const blocks = synthesizeMissingToolResults({ toolUses, completedResults, missingReasons })

    expect(blocks).toHaveLength(2)
    expect(blocks[0].tool_use_id).toBe('a')
    expect(blocks[0].is_error).toBe(false)
    expect(blocks[0].content).toContain('ok')
    expect(blocks[1].tool_use_id).toBe('b')
    expect(blocks[1].is_error).toBe(false)
  })

  it('handles string output directly', () => {
    const toolUses = [makeToolUse('a', 'read')]
    const completedResults = [makeResult('a', 'plain text result')]
    const missingReasons = new Map<string, SynthesisReason>()

    const blocks = synthesizeMissingToolResults({ toolUses, completedResults, missingReasons })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].content).toBe('plain text result')
  })

  it('handles is_error: true from completedResults', () => {
    const toolUses = [makeToolUse('a', 'failing_tool')]
    const completedResults = [makeResult('a', { error: 'something went wrong' }, true)]
    const missingReasons = new Map<string, SynthesisReason>()

    const blocks = synthesizeMissingToolResults({ toolUses, completedResults, missingReasons })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].is_error).toBe(true)
  })

  it('synthesizes error block when tool_use has missingReasons entry', () => {
    const toolUses = [makeToolUse('a', 'blocked_tool'), makeToolUse('b', 'ok_tool')]
    const completedResults = [makeResult('b', { ok: true })]
    const missingReasons = new Map<string, SynthesisReason>([['a', 'hook_blocked']])

    const blocks = synthesizeMissingToolResults({ toolUses, completedResults, missingReasons })

    expect(blocks).toHaveLength(2)
    const blocked = blocks.find(b => b.tool_use_id === 'a')!
    expect(blocked.is_error).toBe(true)
    expect(blocked.content).toContain('Hook')

    const ok = blocks.find(b => b.tool_use_id === 'b')!
    expect(ok.is_error).toBe(false)
  })

  it('uses correct error messages for each SynthesisReason', () => {
    const reasons: SynthesisReason[] = [
      'hook_blocked', 'incomplete_tool_use', 'stream_aborted',
      'loop_terminated', 'sibling_error',
    ]

    for (const reason of reasons) {
      const toolUses = [makeToolUse('a', 'test')]
      const completedResults: Array<{ toolUseId: string; output: unknown; isError: boolean }> = []
      const missingReasons = new Map<string, SynthesisReason>([['a', reason]])

      const blocks = synthesizeMissingToolResults({ toolUses, completedResults, missingReasons })
      expect(blocks).toHaveLength(1)
      expect(blocks[0].is_error).toBe(true)
      expect(blocks[0].content).toBeTruthy()
    }
  })

  it('returns empty array for empty toolUses', () => {
    const blocks = synthesizeMissingToolResults({
      toolUses: [],
      completedResults: [],
      missingReasons: new Map(),
    })
    expect(blocks).toHaveLength(0)
  })

  it('throws when tool_use has neither completedResult nor missingReasons entry', () => {
    const toolUses = [makeToolUse('a', 'orphan')]
    const completedResults: Array<{ toolUseId: string; output: unknown; isError: boolean }> = []
    const missingReasons = new Map<string, SynthesisReason>()

    expect(() =>
      synthesizeMissingToolResults({ toolUses, completedResults, missingReasons }),
    ).toThrow(/programmer error/)
  })

  it('preserves order matching toolUses array', () => {
    const toolUses = [makeToolUse('c', 'third'), makeToolUse('a', 'first'), makeToolUse('b', 'second')]
    const completedResults = [
      makeResult('a', 'A'),
      makeResult('b', 'B'),
      makeResult('c', 'C'),
    ]
    const missingReasons = new Map<string, SynthesisReason>()

    const blocks = synthesizeMissingToolResults({ toolUses, completedResults, missingReasons })
    expect(blocks.map(b => b.tool_use_id)).toEqual(['c', 'a', 'b'])
  })
})

describe('assertToolResultInvariant', () => {
  it('does not throw when all tool_uses have matching tool_results', () => {
    const messages = [
      { role: 'assistant', content: '', toolUses: [makeToolUse('a', 'read')] },
      { role: 'user', content: [{ tool_use_id: 'a', type: 'tool_result' }] },
    ]
    expect(() => assertToolResultInvariant(messages)).not.toThrow()
  })

  it('does not throw when multiple tool_uses all match', () => {
    const messages = [
      { role: 'assistant', content: '', toolUses: [makeToolUse('a', 'read'), makeToolUse('b', 'write')] },
      { role: 'user', content: [
        { tool_use_id: 'a', type: 'tool_result' },
        { tool_use_id: 'b', type: 'tool_result' },
      ]},
    ]
    expect(() => assertToolResultInvariant(messages)).not.toThrow()
  })

  it('throws when a tool_use has no matching tool_result', () => {
    const messages = [
      { role: 'assistant', content: '', toolUses: [makeToolUse('a', 'orphan')] },
      { role: 'user', content: 'just text, no tool_result blocks' },
    ]
    expect(() => assertToolResultInvariant(messages)).toThrow(/unmatched tool_use/)
  })

  it('throws listing all unmatched ids', () => {
    const messages = [
      { role: 'assistant', content: '', toolUses: [makeToolUse('x', 'ex'), makeToolUse('y', 'why')] },
    ]
    expect(() => assertToolResultInvariant(messages)).toThrow(/x.*ex/)
    expect(() => assertToolResultInvariant(messages)).toThrow(/y.*why/)
  })

  it('does not throw when tool_uses are spread across multiple assistant messages', () => {
    const messages = [
      { role: 'assistant', content: '', toolUses: [makeToolUse('a', 'first')] },
      { role: 'user', content: [{ tool_use_id: 'a', type: 'tool_result' }] },
      { role: 'assistant', content: '', toolUses: [makeToolUse('b', 'second')] },
      { role: 'user', content: [{ tool_use_id: 'b', type: 'tool_result' }] },
    ]
    expect(() => assertToolResultInvariant(messages)).not.toThrow()
  })

  it('does not throw when there are no assistant messages with toolUses', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]
    expect(() => assertToolResultInvariant(messages)).not.toThrow()
  })

  it('handles empty message array', () => {
    expect(() => assertToolResultInvariant([])).not.toThrow()
  })
})
