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

  it('stamps subsequent traces with the active ProcedureRun id', async () => {
    const { port, traces } = createMemoryPersistence()
    const tw = new TraceWriter('case_1', port)
    tw.setChatId('chat_1')
    tw.setRunId('run_deposit')

    await tw.write('loop_decision', 'Procedure selected inline: deposit_not_credited')
    tw.setRunId('run_withdrawal')
    await tw.write('form_request', 'Form requested: Withdrawal Details Needed')

    expect(traces).toEqual([
      expect.objectContaining({ runId: 'run_deposit', title: 'Procedure selected inline: deposit_not_credited' }),
      expect.objectContaining({ runId: 'run_withdrawal', title: 'Form requested: Withdrawal Details Needed' }),
    ])
  })

  it('uses payload and explicit run ids as fallbacks around the active run provider', async () => {
    const { port, traces } = createMemoryPersistence()
    const tw = new TraceWriter('case_1', port)
    tw.setRunId('run_cached')
    tw.setRunIdProvider(() => null)

    await tw.write('loop_decision', 'Provider empty')
    await tw.write('loop_decision', 'Payload wins', { runId: 'run_payload' })

    expect(traces).toEqual([
      expect.objectContaining({ runId: 'run_cached', title: 'Provider empty' }),
      expect.objectContaining({ runId: 'run_payload', title: 'Payload wins' }),
    ])
  })
})
