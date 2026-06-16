import { describe, it, expect, beforeEach } from 'vitest'
import {
  hasSession,
  getOrCreateSession,
  closeSession,
  enqueueMessageOrCreate,
  getActiveProcedureRun,
  getProcedureRuntime,
  recordInitialInputEvent,
  getRuntimeEvents,
  getRuntimeSessionStats,
  startProcedureRun,
  getPendingProcedureLlmEvaluations,
  recordProcedureConditionEvaluation,
  recordProcedureToolCall,
  recordProcedureToolResult,
  reconcileProcedureInput,
  recordProcedureTextReply,
  filterRuntimeAuthorityKeys,
  finalizeProcedureRun,
} from '../../session-store'

function simpleToolProcedure(toolName: string) {
  return {
    version: 'v2' as const,
    whenToUse: `Use when ${toolName} is needed.`,
    steps: [
      {
        id: 'lookup',
        title: 'Lookup',
        guidance: `Call ${toolName}.`,
        actions: [
          {
            id: 'lookup_action',
            kind: 'call_tool' as const,
            label: `Call ${toolName}`,
            toolName,
          },
        ],
        branches: [],
      },
      {
        id: 'close',
        title: 'Close',
        guidance: 'Finalize when done.',
        actions: [
          {
            id: 'finish',
            kind: 'end' as const,
            label: 'Finish',
            status: 'completed' as const,
          },
        ],
        branches: [],
      },
    ],
  }
}

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
  it('reports live runtime session stats for internal runtime health', () => {
    const caseId = 'r3-runtime-stats'
    closeSession(caseId)
    const before = getRuntimeSessionStats()
    const session = getOrCreateSession(caseId)
    session.initialized = true
    session.procedureRuntimeHydrated = true

    enqueueMessageOrCreate(caseId, { content: 'queued', source: 'customer_message', origin: 'customer' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: simpleToolProcedure('get_latest_deposit'),
      requestId: 'stats-1',
    })

    const after = getRuntimeSessionStats()
    expect(after.sessions).toBeGreaterThanOrEqual(before.sessions + 1)
    expect(after.liveSessions).toBeGreaterThanOrEqual(before.liveSessions + 1)
    expect(after.initializedSessions).toBeGreaterThanOrEqual(before.initializedSessions + 1)
    expect(after.hydratedSessions).toBeGreaterThanOrEqual(before.hydratedSessions + 1)
    expect(after.activeRuns).toBeGreaterThanOrEqual(before.activeRuns + 1)
    expect(after.queueDepth).toBeGreaterThanOrEqual(before.queueDepth + 1)

    closeSession(caseId)
  })

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
    const procedure = simpleToolProcedure('get_latest_deposit')
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

    const fresh = recordProcedureToolResult(caseId, { toolName: 'get_latest_deposit', toolUseId: 'tool-2', basedOnInputEpoch: 2, toolOutput: { ok: true, status: 'needs_review' } })
    expect(fresh.stale).toBe(false)
    expect(fresh.run?.steps.find((step) => step.id === 'lookup')?.status).toBe('completed')
    closeSession(caseId)
  })

  it('does not advance a required step on an empty success shell', () => {
    const caseId = 'r3-empty-tool-result'
    recordInitialInputEvent(caseId, { content: 'deposit missing' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: simpleToolProcedure('get_latest_deposit'),
      requestId: 'req-empty',
    })

    const empty = recordProcedureToolResult(caseId, {
      toolName: 'get_latest_deposit',
      toolUseId: 'tool-empty',
      basedOnInputEpoch: 1,
      toolOutput: { success: true, list: [] },
    })

    expect(empty.stale).toBe(false)
    expect(empty.run?.currentStepId).toBe('lookup')
    expect(empty.run?.steps.find((step) => step.id === 'lookup')?.status).toBe('blocked')
    expect(empty.run?.blockers).toContain('[action:lookup_action] get_latest_deposit returned no usable result. Ask a clarifying question, retry with a better query, or hand off safely before proceeding.')
    closeSession(caseId)
  })

  it('does not advance a required step when the tool returned a J1B business failure payload', () => {
    const caseId = 'r3-blocking-tool-result'
    recordInitialInputEvent(caseId, { content: 'withdrawal missing' })
    const procedure = simpleToolProcedure('get_latest_withdrawal')
    startProcedureRun(caseId, { procedureId: 'withdrawal_issue', displayName: 'Withdrawal', procedure, requestId: 'req-1' })

    const failed = recordProcedureToolResult(caseId, {
      toolName: 'get_latest_withdrawal',
      toolUseId: 'tool-1',
      basedOnInputEpoch: 1,
      toolOutput: {
        is_v3: true,
        ver: '1.0.0',
        success: false,
        message: 'The selected member id is invalid.',
        errors: {
          member_id: ['The selected member id is invalid.'],
        },
      },
    })

    expect(failed.stale).toBe(false)
    expect(failed.run?.currentStepId).toBe('lookup')
    expect(failed.run?.steps.find((step) => step.id === 'lookup')?.status).toBe('blocked')
    expect(failed.run?.blockers[0]).toContain('get_latest_withdrawal failed')
    closeSession(caseId)
  })

  it('marks stale text replies without advancing ProcedureRun', () => {
    const caseId = 'r3-stale-text'
    recordInitialInputEvent(caseId, { content: 'start' })
    const started = startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: simpleToolProcedure('get_latest_deposit'),
    })
    recordInitialInputEvent(caseId, { content: 'newer input' })

    const stale = recordProcedureTextReply(caseId, { text: 'Old answer', basedOnInputEpoch: 1 })
    expect(stale.stale).toBe(true)
    expect(stale.run?.runId).toBe(started.run.runId)
    expect(stale.run?.currentStepId).toBe('lookup')
    expect(stale.run?.needsReconcile).toBe(true)
    closeSession(caseId)
  })

  it('withholds customer replies while a required runtime tool action is still pending', () => {
    const caseId = 'r3-required-tool-before-reply'
    recordInitialInputEvent(caseId, { content: 'I sent money to an old order.' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_old_order',
      displayName: 'Deposit sent to old order',
      procedure: {
        version: 'v2',
        whenToUse: 'Use when funds were sent to an old order.',
        steps: [
          {
            id: 'review_recent_transactions',
            title: 'Review recent transactions',
            guidance: 'Call transaction history before telling the customer what will happen next.',
            actions: [
              {
                id: 'review_recent_transactions_tool',
                kind: 'call_tool',
                label: 'Review recent transactions',
                toolName: 'get_transaction_history',
                required: true,
              },
            ],
            branches: [],
          },
        ],
      },
    })

    const reply = recordProcedureTextReply(caseId, {
      text: '我已经记录您的旧订单信息，请稍等，我将为您进行处理。',
      basedOnInputEpoch: 1,
    })

    expect(reply.stale).toBe(false)
    expect(reply.blockedReason).toContain('requires get_transaction_history before replying')
    expect(reply.run?.evidence.at(-1)).toMatchObject({
      kind: 'text_reply',
      label: 'Unsafe ProcedureRun text reply withheld',
      state: 'stale',
    })
    closeSession(caseId)
  })

  it('withholds a human-handoff promise until create_human_task produces persisted evidence', () => {
    const caseId = 'r3-human-promise-gate'
    recordInitialInputEvent(caseId, { content: 'Please transfer me to a human.' })
    startProcedureRun(caseId, {
      procedureId: 'human_support_requested',
      displayName: 'Human support requested',
      procedure: {
        version: 'v2',
        whenToUse: 'Use when the customer wants a human agent.',
        steps: [
          {
            id: 'handoff',
            title: 'Request human support',
            guidance: 'Create a persisted human handoff before promising one to the customer.',
            actions: [
              {
                id: 'handoff_now',
                kind: 'request_human_handoff',
                label: 'Request human help',
                queue: 'general',
              },
            ],
            branches: [],
          },
        ],
      },
    })

    const reply = recordProcedureTextReply(caseId, {
      text: '已安排人工客服为您继续处理，请稍候。',
      basedOnInputEpoch: 1,
    })

    expect(reply.stale).toBe(false)
    expect(reply.blockedReason).toContain('human-handoff promise')
    expect(reply.run?.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('human-handoff promise'),
      ]),
    )
    expect(reply.run?.evidence.at(-1)).toMatchObject({
      kind: 'text_reply',
      label: 'Unsafe human-handoff promise withheld',
      state: 'stale',
      metadata: expect.objectContaining({
        blockedReason: expect.stringContaining('human-handoff promise'),
      }),
    })
    closeSession(caseId)
  })

  it('withholds softer Chinese manual-processing promises without persisted handoff evidence', () => {
    const caseId = 'r3-human-promise-soft-zh'
    recordInitialInputEvent(caseId, { content: '我忘了提款密码，请人工帮我重置。' })
    startProcedureRun(caseId, {
      procedureId: 'withdrawal_password_reset',
      displayName: 'Forgot withdrawal password',
      procedure: {
        version: 'v2',
        whenToUse: 'Use when withdrawal-password recovery needs help.',
        steps: [
          {
            id: 'handoff',
            title: 'Request manual reset help',
            guidance: 'Create a persisted human handoff before promising manual handling.',
            actions: [
              {
                id: 'handoff_now',
                kind: 'request_human_handoff',
                label: 'Request human help',
                queue: 'account_security',
              },
            ],
            branches: [],
          },
        ],
      },
    })

    for (const text of [
      '您已提供会员ID和登录账号，正在为您人工处理提款密码重置，请稍候。',
      '若需要进一步身份验证，客服会联系您。',
      '专员会尽快联系您继续处理。',
      '我已经为您提交了人工重置登录密码的申请，请耐心等待。',
      '我已经为您转接人工客服，请稍等，人工客服将直接协助您修改账户资料。',
      '我们已将您的情况转交人工复核，稍后会有客服人员与您联系。',
    ]) {
      const reply = recordProcedureTextReply(caseId, { text, basedOnInputEpoch: 1 })
      expect(reply.stale).toBe(false)
      expect(reply.blockedReason).toContain('human-handoff promise')
      expect(reply.run?.evidence.at(-1)).toMatchObject({
        kind: 'text_reply',
        label: 'Unsafe human-handoff promise withheld',
        state: 'stale',
      })
    }

    closeSession(caseId)
  })

  it('allows a human-handoff promise after persisted create_human_task evidence exists', () => {
    const caseId = 'r3-human-promise-allowed'
    recordInitialInputEvent(caseId, { content: 'Please transfer me to a human.' })
    startProcedureRun(caseId, {
      procedureId: 'human_support_requested',
      displayName: 'Human support requested',
      procedure: {
        version: 'v2',
        whenToUse: 'Use when the customer wants a human agent.',
        steps: [
          {
            id: 'handoff',
            title: 'Request human support',
            guidance: 'Create a persisted human handoff before promising one to the customer.',
            actions: [
              {
                id: 'handoff_now',
                kind: 'request_human_handoff',
                label: 'Request human help',
                queue: 'general',
              },
            ],
            branches: [],
          },
        ],
      },
    })

    const session = getOrCreateSession(caseId)
    session.procedureRuntime.activeProcedureRun?.evidence.push({
      id: 'handoff-1',
      kind: 'handoff',
      label: 'Human handoff requested',
      toolName: 'create_human_task',
      basedOnInputEpoch: 1,
      state: 'canonical',
      createdAt: new Date().toISOString(),
      metadata: {
        outcome: 'succeeded',
        output: { taskId: 'task-1', queue: 'general', status: 'pending', persisted: true },
      },
    })

    const reply = recordProcedureTextReply(caseId, {
      text: '已安排人工客服继续处理，专员将尽快与您联系。',
      basedOnInputEpoch: 1,
    })

    expect(reply.stale).toBe(false)
    expect(reply.blockedReason).toBeUndefined()
    expect(reply.run?.blockers).toEqual([])
    expect(reply.run?.evidence.at(-1)).toMatchObject({
      kind: 'text_reply',
      label: 'Customer-facing reply drafted',
      state: 'canonical',
      metadata: expect.objectContaining({
        blockedReason: undefined,
      }),
    })
    closeSession(caseId)
  })

  it('raises and clears the explicit human request runtime signal on the v2 path', () => {
    const caseId = 'r3-human-request-signal'
    recordInitialInputEvent(caseId, { content: 'start' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'triage',
            title: 'Triage the request',
            guidance: 'Work out whether the customer needs a person right away.',
            actions: [],
            branches: [
              {
                id: 'customer_wants_human',
                kind: 'if',
                condition: { kind: 'runtime_signal', signal: 'explicit_human_request' },
                actions: [
                  {
                    id: 'handoff_now',
                    kind: 'request_human_handoff',
                    label: 'Request human help',
                    queue: 'general',
                  },
                ],
              },
            ],
          },
        ],
      },
    })

    recordInitialInputEvent(caseId, { content: 'Please connect me to a human agent right now.' })
    expect(getActiveProcedureRun(caseId)?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: 'explicit_human_request', active: true }),
      ]),
    )
    expect(getActiveProcedureRun(caseId)?.steps[0]?.branches?.[0]?.status).toBe('matched')

    const handoff = recordProcedureToolResult(caseId, {
      toolName: 'create_human_task',
      toolUseId: 'handoff-1',
      basedOnInputEpoch: 2,
      toolOutput: { taskId: 'task-1', queue: 'general', status: 'pending', persisted: true },
    })
    expect(handoff.stale).toBe(false)
    expect(handoff.run?.signals.find((signal) => signal.signal === 'explicit_human_request')?.active).toBe(false)
    closeSession(caseId)
  })

  it('hydrates explicit human request from pre-start customer input when the procedure starts later', () => {
    const caseId = 'r3-seeded-human-request-signal'
    recordInitialInputEvent(caseId, { content: 'Please connect me to a human agent right now.' })

    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'triage',
            title: 'Triage the request',
            guidance: 'Work out whether the customer needs a person right away.',
            actions: [],
            branches: [
              {
                id: 'customer_wants_human',
                kind: 'if',
                condition: { kind: 'runtime_signal', signal: 'explicit_human_request' },
                actions: [
                  {
                    id: 'handoff_now',
                    kind: 'request_human_handoff',
                    label: 'Request human help',
                    queue: 'general',
                  },
                ],
              },
            ],
          },
        ],
      },
    })

    const active = getActiveProcedureRun(caseId)
    expect(active?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: 'explicit_human_request', active: true }),
      ]),
    )
    expect(active?.steps[0]?.branches?.[0]).toMatchObject({ status: 'matched' })
    closeSession(caseId)
  })

  it('resolves an inactive runtime_signal branch as skipped so the else path can match', () => {
    const caseId = 'r3-runtime-signal-else'
    recordInitialInputEvent(caseId, { content: 'My deposit has not arrived yet.' })
    const started = startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'triage',
            title: 'Triage the request',
            guidance: 'Hand off right away when the customer asks for a person.',
            actions: [],
            branches: [
              {
                id: 'wants_human',
                kind: 'if',
                condition: { kind: 'runtime_signal', signal: 'explicit_human_request' },
                actions: [
                  {
                    id: 'handoff_now',
                    kind: 'request_human_handoff',
                    label: 'Request human help',
                    queue: 'general',
                  },
                ],
              },
              {
                id: 'continue_self_serve',
                kind: 'else',
                actions: [
                  {
                    id: 'end_step',
                    kind: 'end',
                    label: 'Close out the request',
                    status: 'completed',
                  },
                ],
              },
            ],
          },
        ],
      },
    })

    recordInitialInputEvent(caseId, { content: 'It was 500 USD sent yesterday evening.' })

    const triage = getActiveProcedureRun(caseId)?.steps[0]
    expect(triage?.branches?.find((branch) => branch.id === 'wants_human')).toMatchObject({
      status: 'skipped',
    })
    expect(triage?.branches?.find((branch) => branch.id === 'continue_self_serve')).toMatchObject({
      status: 'matched',
    })

    reconcileProcedureInput(caseId, {
      runId: started.run.runId,
      upToInputEpoch: 2,
      decision: 'continue',
      summary: 'Reviewed the latest deposit details.',
    })
    const ended = recordProcedureToolResult(caseId, {
      toolName: 'finalize_procedure',
      toolUseId: 'end-1',
      basedOnInputEpoch: 2,
      toolOutput: { ok: true, status: 'completed' },
    })
    expect(ended.run?.steps[0]?.status).toBe('completed')
    expect(finalizeProcedureRun(caseId, { runId: started.run.runId, basedOnInputEpoch: 2 })).toMatchObject({
      ok: true,
    })
    closeSession(caseId)
  })

  it('completes a branch-only step once every branch is resolved with no applicable action', () => {
    const caseId = 'r3-runtime-signal-no-else'
    recordInitialInputEvent(caseId, { content: 'My deposit has not arrived yet.' })
    const started = startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'triage',
            title: 'Triage the request',
            guidance: 'Hand off when the customer asks for a person; otherwise continue.',
            actions: [],
            branches: [
              {
                id: 'wants_human',
                kind: 'if',
                condition: { kind: 'runtime_signal', signal: 'explicit_human_request' },
                actions: [
                  {
                    id: 'handoff_now',
                    kind: 'request_human_handoff',
                    label: 'Request human help',
                    queue: 'general',
                  },
                ],
              },
            ],
          },
          {
            id: 'close',
            title: 'Close out',
            guidance: 'Finish up once triage is done.',
            actions: [
              {
                id: 'end_step',
                kind: 'end',
                label: 'Close out the request',
                status: 'completed',
              },
            ],
            branches: [],
          },
        ],
      },
    })

    recordInitialInputEvent(caseId, { content: 'It was 500 USD sent yesterday evening.' })

    const run = getActiveProcedureRun(caseId)
    expect(run?.steps.find((step) => step.id === 'triage')).toMatchObject({
      status: 'completed',
    })
    expect(run?.currentStepId).toBe('close')

    reconcileProcedureInput(caseId, {
      runId: started.run.runId,
      upToInputEpoch: 2,
      decision: 'continue',
      summary: 'Reviewed the latest deposit details.',
    })
    recordProcedureToolResult(caseId, {
      toolName: 'finalize_procedure',
      toolUseId: 'end-1',
      basedOnInputEpoch: 2,
      toolOutput: { ok: true, status: 'completed' },
    })
    expect(finalizeProcedureRun(caseId, { runId: started.run.runId, basedOnInputEpoch: 2 })).toMatchObject({
      ok: true,
    })
    closeSession(caseId)
  })

  it('raises the knowledge gap signal and clears it after knowledge search evidence lands', () => {
    const caseId = 'r3-knowledge-gap'
    recordInitialInputEvent(caseId, { content: 'start' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'orient_customer',
            title: 'Orient the customer',
            guidance: 'Point the customer to the right documentation when they are missing context.',
            actions: [
              {
                id: 'search_docs',
                kind: 'search_knowledge',
                label: 'Search the deposit FAQ',
                suggestedSources: ['Deposit FAQ'],
              },
            ],
            branches: [],
          },
        ],
      },
    })

    recordInitialInputEvent(caseId, { content: 'Where do I find the deposit receipt page?' })
    expect(getActiveProcedureRun(caseId)?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: 'knowledge_gap', active: true }),
      ]),
    )

    const knowledge = recordProcedureToolResult(caseId, {
      toolName: 'kb_search_deposit_faq',
      toolUseId: 'kb-1',
      basedOnInputEpoch: 2,
      toolOutput: { hits: [{ id: 'faq-1', title: 'Deposit receipt guide' }] },
      isKnowledgeTool: true,
    })
    expect(knowledge.stale).toBe(false)
    expect(knowledge.run?.signals.find((signal) => signal.signal === 'knowledge_gap')?.active).toBe(false)
    expect(knowledge.run?.steps.find((step) => step.id === 'orient_customer')?.status).toBe('completed')
    closeSession(caseId)
  })

  it('clears knowledge-gap blockers for structured knowledge tools even when the tool name has no kb_search_ prefix', () => {
    const caseId = 'r3-knowledge-metadata'
    const session = getOrCreateSession(caseId)
    session.loop = {
      getToolDefinition(name: string) {
        if (name !== 'faq_lookup_default') return undefined
        return {
          name,
          description: 'Search FAQ',
          inputSchema: { type: 'object', properties: {}, required: [] },
          mode: 'system_managed',
          isConcurrencySafe: true,
          enabled: true,
          knowledgeSourceId: 'ks_faq',
        }
      },
    } as any

    recordInitialInputEvent(caseId, { content: 'deposit missing' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'orient_customer',
            title: 'Orient the customer',
            guidance: 'Use knowledge before answering.',
            actions: [
              {
                id: 'knowledge_lookup',
                kind: 'search_knowledge',
                label: 'Search FAQ',
                suggestedSources: ['deposit_faq'],
              },
            ],
            branches: [],
          },
        ],
      },
    })

    const runBeforeResult = getActiveProcedureRun(caseId)
    expect(runBeforeResult?.steps.find((step) => step.id === 'orient_customer')?.status).toBe('active')

    const knowledge = recordProcedureToolResult(caseId, {
      toolName: 'faq_lookup_default',
      toolUseId: 'faq-hit',
      basedOnInputEpoch: 1,
      toolOutput: { hits: [{ title: 'FAQ hit' }] },
      isKnowledgeTool: true,
    })

    expect(knowledge.stale).toBe(false)
    expect(knowledge.run?.steps.find((step) => step.id === 'orient_customer')?.status).toBe('completed')
    expect(knowledge.run?.evidence.find((entry) => entry.id === 'faq-hit')?.kind).toBe('knowledge')
    closeSession(caseId)
  })

  it('records llm_eval receipts and uses them to resolve v2 branches', () => {
    const caseId = 'r3-llm-eval'
    recordInitialInputEvent(caseId, { content: 'I only need the public FAQ link.' })
    const started = startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'triage',
            title: 'Decide whether the customer only needs documentation',
            guidance: 'Route documentation-only requests to knowledge search.',
            actions: [],
            branches: [
              {
                id: 'docs_only',
                kind: 'if',
                condition: {
                  id: 'docs_only_eval',
                  kind: 'llm_eval',
                  prompt: 'Does the customer only need documentation or a public link, with no account-specific action?',
                },
                actions: [
                  {
                    id: 'search_docs',
                    kind: 'search_knowledge',
                    label: 'Search the FAQ',
                    suggestedSources: ['Deposit FAQ'],
                  },
                ],
              },
              {
                id: 'fallback',
                kind: 'else',
                actions: [
                  {
                    id: 'handoff',
                    kind: 'request_human_handoff',
                    label: 'Request human help',
                    queue: 'general',
                  },
                ],
              },
            ],
          },
        ],
      },
    })

    const pending = getPendingProcedureLlmEvaluations(caseId)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      runId: started.run.runId,
      branchId: 'docs_only',
      conditionId: 'docs_only_eval',
    })

    const receipt = recordProcedureConditionEvaluation(caseId, {
      runId: started.run.runId,
      branchId: 'docs_only',
      conditionId: 'docs_only_eval',
      label: 'documentation only',
      decision: 'matched',
      reason: 'The customer explicitly asked for a public FAQ link and did not request account-specific action.',
      basedOnInputEpoch: 1,
      model: 'test-evaluator',
    })
    expect(receipt.ok).toBe(true)
    const active = getActiveProcedureRun(caseId)
    expect(active?.steps[0]?.branches?.find((branch) => branch.id === 'docs_only')).toMatchObject({
      status: 'matched',
    })
    expect(active?.evaluations[0]).toMatchObject({
      branchId: 'docs_only',
      decision: 'matched',
      model: 'test-evaluator',
    })
    closeSession(caseId)
  })

  it('captures v2 form answers as runtime inputs and evidence without writing legacy facts', () => {
    const caseId = 'r3-v2-form-runtime-truth'
    recordInitialInputEvent(caseId, { content: 'I can send the member id.' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'collect_member_id',
            title: 'Collect the member id',
            guidance: 'Ask the customer for their member id.',
            actions: [
              {
                id: 'ask_member_id',
                kind: 'ask',
                label: 'Ask for member id',
                fields: ['memberId'],
              },
            ],
            branches: [],
          },
        ],
      },
    })

    recordInitialInputEvent(caseId, {
      content: 'Tool ask_user_questions result: {"memberId":"M123"}',
      source: 'customer_form_result',
      origin: 'customer',
      formAnswers: { memberId: 'M123' },
    })

    const active = getActiveProcedureRun(caseId)
    expect(active?.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'customer_form_result',
          formAnswers: { memberId: 'M123' },
        }),
      ]),
    )
    expect(active?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'form',
          metadata: expect.objectContaining({ field: 'memberId', value: 'M123' }),
        }),
      ]),
    )
    expect(active?.steps.find((step) => step.id === 'collect_member_id')).toMatchObject({
      status: 'completed',
    })
    closeSession(caseId)
  })

  it('blocks v2 steps on empty knowledge results instead of treating them as success', () => {
    const caseId = 'r3-empty-kb'
    recordInitialInputEvent(caseId, { content: 'Where do I find the statement page?' })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'orient_customer',
            title: 'Orient the customer',
            guidance: 'Use knowledge search before answering.',
            actions: [
              {
                id: 'search_docs',
                kind: 'search_knowledge',
                label: 'Search the FAQ',
                suggestedSources: ['Deposit FAQ'],
              },
            ],
            branches: [],
          },
        ],
      },
    })

    const knowledge = recordProcedureToolResult(caseId, {
      toolName: 'kb_search_deposit_faq',
      toolUseId: 'kb-empty',
      basedOnInputEpoch: 1,
      toolOutput: { hits: [] },
      isKnowledgeTool: true,
    })
    expect(knowledge.run?.steps.find((step) => step.id === 'orient_customer')).toMatchObject({
      status: 'blocked',
    })
    expect(knowledge.run?.evidence.find((entry) => entry.id === 'kb-empty')?.metadata).toMatchObject({
      outcome: 'empty_result',
    })
    expect(finalizeProcedureRun(caseId, { runId: knowledge.run?.runId })).toMatchObject({
      ok: false,
      stale: false,
    })
    closeSession(caseId)
  })

  it('finalizes the ProcedureRun after persisted handoff and clears stale blockers from prior empty knowledge results', () => {
    const caseId = 'r3-v2-handoff-terminal'
    recordInitialInputEvent(caseId, { content: 'Where do I find the deposit receipt page?' })
    const started = startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'guide_or_handoff',
            title: 'Guide or hand off',
            guidance: 'Search docs first, then hand off when needed.',
            actions: [],
            branches: [
              {
                id: 'handoff_after_failed_docs_or_explicit_request',
                kind: 'if',
                condition: {
                  id: 'handoff_eval',
                  kind: 'llm_eval',
                  prompt: 'Should the case now be handed to a human because the customer explicitly asks for one or the documentation lookup failed?',
                },
                actions: [
                  {
                    id: 'search_docs',
                    kind: 'search_knowledge',
                    label: 'Search the FAQ',
                    suggestedSources: ['deposit_faq'],
                    required: false,
                  },
                  {
                    id: 'request_handoff',
                    kind: 'request_human_handoff',
                    label: 'Request human help',
                    queue: 'general',
                  },
                ],
              },
              {
                id: 'finish_without_handoff',
                kind: 'else',
                actions: [
                  {
                    id: 'end_step',
                    kind: 'end',
                    label: 'End the procedure',
                    status: 'completed',
                  },
                ],
              },
            ],
          },
        ],
      },
    })

    recordProcedureConditionEvaluation(caseId, {
      runId: started.run.runId,
      branchId: 'handoff_after_failed_docs_or_explicit_request',
      conditionId: 'handoff_eval',
      label: 'handoff after failed docs',
      decision: 'matched',
      reason: 'The customer still needs a person after the documentation lookup did not help.',
      basedOnInputEpoch: 1,
      model: 'test-evaluator',
      metadata: { mode: 'test' },
    })
    recordProcedureToolResult(caseId, {
      toolName: 'kb_search_deposit_faq',
      toolUseId: 'kb-empty',
      basedOnInputEpoch: 1,
      toolOutput: { hits: [] },
      isKnowledgeTool: true,
    })

    const pendingHandoff = recordProcedureToolResult(caseId, {
      toolName: 'create_human_task',
      toolUseId: 'handoff-pending',
      basedOnInputEpoch: 1,
      toolOutput: { taskId: 'task-1', queue: 'general', status: 'pending' },
    })
    expect(getActiveProcedureRun(caseId)?.status).toBe('active')
    expect(pendingHandoff.run?.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('has not produced persisted handoff evidence yet'),
      ]),
    )

    const persistedHandoff = recordProcedureToolResult(caseId, {
      toolName: 'create_human_task',
      toolUseId: 'handoff-1',
      basedOnInputEpoch: 1,
      toolOutput: { taskId: 'task-1', queue: 'general', status: 'pending', persisted: true },
    })

    expect(getActiveProcedureRun(caseId)).toBeUndefined()
    const completed = getProcedureRuntime(caseId).completedProcedureRuns[0]
    expect(completed).toMatchObject({
      runId: started.run.runId,
      status: 'completed',
      currentStepId: null,
      reason: 'Finalized after human handoff task task-1.',
      outcome: 'handed_off',
      blockers: [],
    })
    const step = completed.steps.find((entry) => entry.id === 'guide_or_handoff')
    expect(step).toMatchObject({
      status: 'completed',
      completionReason: 'Persisted human handoff task task-1 created.',
    })
    expect(step?.actions?.find((action) => action.id === 'search_docs')?.status).toBe('skipped')
    expect(step?.actions?.find((action) => action.id === 'request_handoff')?.status).toBe('completed')
    expect(step?.branches?.find((branch) => branch.id === 'handoff_after_failed_docs_or_explicit_request')).toMatchObject({
      status: 'matched',
    })
    expect(step?.branches?.find((branch) => branch.id === 'finish_without_handoff')).toMatchObject({
      status: 'skipped',
      reason: 'Another branch already matched.',
    })
    expect(completed.evidence.find((entry) => entry.id === 'handoff-1')?.metadata).toMatchObject({
      outcome: 'succeeded',
      output: expect.objectContaining({ persisted: true }),
    })
    expect(persistedHandoff.run?.status).toBe('completed')
    expect(persistedHandoff.run?.blockers).toEqual([])
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
