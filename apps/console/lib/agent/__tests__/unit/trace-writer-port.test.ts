import { describe, it, expect } from 'vitest'
import { TraceWriter } from '../../trace'
import { createMemoryPersistence } from '../../persistence-port'

describe('TraceWriter → PersistencePort', () => {
  it('writes through the port, never touching prisma, and serialises payload', async () => {
    const { port, traces } = createMemoryPersistence()
    const tw = new TraceWriter('case_1', port)
    tw.setChatId('chat_1')
    await tw.write('hook_hit', 'Hook hit: tone', { hookName: 'tone', result: 'warn' })
    await tw.write('tool_result', 'Tool: kb_search', { toolName: 'kb_search', output: { hits: 2 } })

    expect(traces).toHaveLength(2)
    expect(traces[0]).toMatchObject({ caseId: 'case_1', chatId: 'chat_1', actionType: 'hook_hit' })
    expect(traces[1]).toMatchObject({ caseId: 'case_1', chatId: 'chat_1', actionType: 'tool_result' })
    // payload must be a JSON string (matches Prisma column shape — single contract)
    expect(typeof traces[0].payload).toBe('string')
    expect(JSON.parse(traces[1].payload as string)).toMatchObject({ toolName: 'kb_search' })
  })
})
