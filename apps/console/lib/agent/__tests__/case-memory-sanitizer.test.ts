import { describe, expect, it } from 'vitest'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { ChatMemoryManager } from '../memory'
import { sanitizeCaseMemorySummary } from '../case-memory-sanitizer'

describe('case memory summary sanitizer', () => {
  it('removes raw provider transcript lines but preserves readable case evidence', () => {
    const summary = sanitizeCaseMemorySummary([
      '## Context Map',
      '- member_id: JAYA1197202',
      '## Tools Run',
      '- [assistant tool_use id=toolu_1 name=lookup_deposit input={"member_id":"JAYA1197202"}]',
      '- lookup_deposit returned approved deposit status.',
      '- [user tool_result tool_use_id=toolu_1 content={"status":"approved"}]',
      '## Open Items',
      '- Confirm whether balance updated.',
    ].join('\n'))

    expect(summary).toContain('member_id: JAYA1197202')
    expect(summary).toContain('lookup_deposit returned approved deposit status.')
    expect(summary).toContain('Confirm whether balance updated.')
    expect(summary).not.toMatch(/tool_use|tool_result|tool_use_id|input=\{/i)
  })

  it('sanitizes summaries written through ChatMemoryManager.setSummary', () => {
    const memory = new ChatMemoryManager('case-chat-memory', DEFAULT_MEMORY_STRATEGY)

    memory.setSummary([
      '## Tools Run',
      '- [assistant tool_use id=toolu_1 name=lookup_deposit input={}]',
      '- lookup_deposit returned approved deposit status.',
      '- [user tool_result tool_use_id=toolu_1 content={"status":"approved"}]',
    ].join('\n'))

    expect(memory.getSummary().summary).toContain('lookup_deposit returned approved deposit status.')
    expect(memory.getSummary().summary).not.toMatch(/tool_use|tool_result|tool_use_id/i)
  })

  it('sanitizes fallback compaction summaries before persistence', async () => {
    const memory = new ChatMemoryManager('case-chat-memory', DEFAULT_MEMORY_STRATEGY)

    await memory.applyToolResult('lookup_deposit', {
      status: 'approved',
      providerContent: '[assistant tool_use id=toolu_1 name=lookup_deposit input={}]',
    })
    memory.setSummary('[user tool_result tool_use_id=toolu_1 content={"status":"approved"}]\nPrevious readable summary.')

    const summary = memory.recordCompaction()

    expect(summary).toContain('lookup_deposit')
    expect(summary).toContain('Previous readable summary.')
    expect(summary).not.toMatch(/tool_use|tool_result|tool_use_id|providerContent/i)
  })
})
