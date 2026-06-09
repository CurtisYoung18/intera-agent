import { describe, it, expect, beforeEach } from 'vitest'
import {
  hasSession,
  getOrCreateSession,
  closeSession,
  enqueueMessageOrCreate,
  recordInitialInputEvent,
  getRuntimeEvents,
  startProcedureRun,
  recordProcedureToolCall,
  recordProcedureToolResult,
  reconcileProcedureInput,
  recordProcedureTextReply,
  filterRuntimeAuthorityKeys,
} from '../../session-store'

describe('hasSession', () => {
  beforeEach(() => {
    // Clean up any sessions created by other tests
    // closeSession removes from registry
  })

  it('returns false for non-existent session', () => {
    expect(hasSession('non-existent-case')).toBe(false)
  })

  it('returns true for active session (!aborted, !resolved)', () => {
    const s = getOrCreateSession('case-1')
    expect(hasSession('case-1')).toBe(true)
    expect(s.resolved).toBe(false)
    expect(s.aborted).toBe(false)
    closeSession('case-1')
  })

  it('returns false for aborted session', () => {
    getOrCreateSession('case-2')
    closeSession('case-2')
    expect(hasSession('case-2')).toBe(false)
  })

  it('returns false for resolved session', () => {
    const s = getOrCreateSession('case-3')
    s.resolved = true
    expect(hasSession('case-3')).toBe(false)
    closeSession('case-3')
  })

  it('returns false for resolved + not aborted (the exact bug scenario)', () => {
    const s = getOrCreateSession('case-4')
    s.resolved = true
    // aborted is still false — this is the state after agent loop completes
    expect(s.aborted).toBe(false)
    expect(s.resolved).toBe(true)
    expect(hasSession('case-4')).toBe(false)
    closeSession('case-4')
  })
})

describe('R3 runtime event protocol', () => {
  it('stamps queued inputs with event metadata and enqueue-time epochs', () => {
    const caseId = 'r3-events-case'
    recordInitialInputEvent(caseId, { content: 'first', source: 'customer_message', origin: 'customer' })
    const session = enqueueMessageOrCreate(caseId, { content: 'second', source: 'customer_message', origin: 'customer' })
    enqueueMessageOrCreate(caseId, { content: 'third', source: 'customer_message', origin: 'customer' })

    const events = getRuntimeEvents(caseId)
    expect(events.map((event) => event.inputEpoch)).toEqual([1, 2, 3])
    expect(events.every((event) => event.eventId && event.sessionId && event.enqueuedAt && event.caseId === caseId)).toBe(true)
    expect(events[1]).toMatchObject({ origin: 'customer', source: 'customer_message', priority: 0, enqueuePolicy: 'fifo' })

    expect(session.queue.dequeueNonBlocking()?.content).toBe('second')
    expect(session.queue.dequeueNonBlocking()?.content).toBe('third')
    closeSession(caseId)
  })

  it('uses one structured event shape for inputs, tools, replies, hooks, reconcile and controls', () => {
    const caseId = 'r3-shared-shape'
    recordInitialInputEvent(caseId, { content: 'hello', source: 'customer_message', origin: 'customer' })
    const sources = [
      'customer_form_result',
      'human_task_result',
      'tool_call',
      'tool_result',
      'text_reply',
      'hook_decision',
      'reconcile',
      'control',
    ] as const

    for (const source of sources) {
      enqueueMessageOrCreate(caseId, {
        content: source,
        source,
        origin: source === 'human_task_result' ? 'human' : source === 'control' ? 'operator' : 'system',
        isControl: source === 'control',
      })
    }

    const events = getRuntimeEvents(caseId)
    expect(new Set(events.map((event) => event.source))).toEqual(new Set(['customer_message', ...sources]))
    expect(events.every((event) => 'eventId' in event && 'inputEpoch' in event && 'origin' in event && 'source' in event && 'enqueuedAt' in event && 'sessionId' in event)).toBe(true)
    closeSession(caseId)
  })

  it('keeps stale tool results as evidence until reconcile clears the current epoch', () => {
    const caseId = 'r3-stale-tool'
    recordInitialInputEvent(caseId, { content: 'deposit missing' })
    const procedure = {
      steps: [
        { id: 'lookup', action: 'use' as const, target: 'get_latest_deposit', required: true },
        { id: 'close', action: 'finalize' as const, target: 'resolved' },
      ],
    }
    const started = startProcedureRun(caseId, { procedureId: 'deposit_issue', displayName: 'Deposit', procedure, requestId: 'req-1' })
    expect(started.run.currentStepId).toBe('lookup')

    recordProcedureToolCall(caseId, { toolName: 'get_latest_deposit', toolUseId: 'tool-1', basedOnInputEpoch: 1 })
    recordInitialInputEvent(caseId, { content: 'amount is 500' })
    const stale = recordProcedureToolResult(caseId, { toolName: 'get_latest_deposit', toolUseId: 'tool-1', basedOnInputEpoch: 1, toolOutput: { ok: true } })
    expect(stale.stale).toBe(true)
    expect(stale.run?.needsReconcile).toBe(true)
    expect(stale.run?.currentStepId).toBe('lookup')
    expect(stale.run?.steps.find((step) => step.id === 'lookup')?.status).toBe('active')

    const partial = reconcileProcedureInput(caseId, { runId: started.run.runId, upToInputEpoch: 1, decision: 'not enough', summary: 'Only reconciled old input.' })
    expect(partial.cleared).toBe(false)
    const cleared = reconcileProcedureInput(caseId, { runId: started.run.runId, upToInputEpoch: 2, decision: 'continue', summary: 'Latest amount included.' })
    expect(cleared.cleared).toBe(true)

    const fresh = recordProcedureToolResult(caseId, { toolName: 'get_latest_deposit', toolUseId: 'tool-2', basedOnInputEpoch: 2, toolOutput: { ok: true } })
    expect(fresh.stale).toBe(false)
    expect(fresh.run?.steps.find((step) => step.id === 'lookup')?.status).toBe('completed')
    closeSession(caseId)
  })

  it('marks stale text replies without advancing ProcedureRun', () => {
    const caseId = 'r3-stale-text'
    recordInitialInputEvent(caseId, { content: 'start' })
    const started = startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: { steps: [{ id: 'lookup', action: 'use', target: 'get_latest_deposit' }] },
    })
    recordInitialInputEvent(caseId, { content: 'newer input' })

    const stale = recordProcedureTextReply(caseId, { text: 'Old answer', basedOnInputEpoch: 1 })
    expect(stale.stale).toBe(true)
    expect(stale.run?.runId).toBe(started.run.runId)
    expect(stale.run?.currentStepId).toBe('lookup')
    expect(stale.run?.needsReconcile).toBe(true)
    closeSession(caseId)
  })

  it('makes start_procedure idempotent by request id and active run', () => {
    const caseId = 'r3-idempotent'
    recordInitialInputEvent(caseId, { content: 'start' })
    const first = startProcedureRun(caseId, { procedureId: 'deposit_issue', displayName: 'Deposit', requestId: 'same' })
    const second = startProcedureRun(caseId, { procedureId: 'deposit_issue', displayName: 'Deposit', requestId: 'same' })
    const third = startProcedureRun(caseId, { procedureId: 'deposit_issue', displayName: 'Deposit', requestId: 'different' })

    expect(second.idempotent).toBe(true)
    expect(third.idempotent).toBe(true)
    expect(second.run.runId).toBe(first.run.runId)
    expect(third.run.runId).toBe(first.run.runId)
    closeSession(caseId)
  })

  it('filters ProcedureRun authority keys out of memory payloads', () => {
    expect(filterRuntimeAuthorityKeys({
      memberId: 'M123',
      currentStepId: 'lookup',
      needsReconcile: true,
      activeProcedureRun: { runId: 'r1' },
    })).toEqual({ memberId: 'M123' })
  })
})
