import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  assertAgentInOrg: vi.fn(async () => {}),
}))

vi.mock('@/lib/api/assert-agent-in-org', () => ({
  assertAgentInOrg: h.assertAgentInOrg,
}))

import { buildChatForensicPack } from '../forensic-pack'
import { NotFoundError } from '@/lib/api/define-route'

const baseCase = {
  id: 'case-1',
  orgId: 'org-1',
  userId: 'customer-1',
  chatId: 'chat-1',
  type: 'deposit_not_credited',
  status: 'investigating',
  source: 'live',
  goal: 'Check a missing deposit',
  blocker: null,
  runtimeInputEpoch: 1,
  createdAt: new Date('2026-06-26T00:00:00.000Z'),
  updatedAt: new Date('2026-06-26T00:00:10.000Z'),
  resolvedAt: null,
}

const baseRun = {
  id: 'run-1',
  orgId: 'org-1',
  caseId: 'case-1',
  chatId: 'chat-1',
  agentConfigId: 'agent-1',
  procedureId: 'deposit_not_credited',
  status: 'active',
  inputEpoch: 1,
  currentStepId: 'collect_details',
  outcome: null,
  state: {
    steps: [{ id: 'collect_details', status: 'active' }],
    blockers: ['waiting for receipt'],
    timeline: [{
      at: '2026-06-26T00:00:02.000Z',
      origin: 'customer',
      source: 'customer_message',
      summary: 'Customer reports a missing deposit.',
      basedOnInputEpoch: 1,
      isMeta: false,
      eventId: 'evt_internal_1',
    }],
  },
  createdAt: new Date('2026-06-26T00:00:01.000Z'),
  updatedAt: new Date('2026-06-26T00:00:08.000Z'),
}

function matchesWhere(row: Record<string, any>, where: Record<string, any> = {}): boolean {
  if (where.orgId && row.orgId !== where.orgId) return false
  if (where.chatId && typeof where.chatId === 'string' && row.chatId !== where.chatId) return false
  if (
    where.chatId &&
    typeof where.chatId === 'object' &&
    where.chatId.startsWith &&
    !row.chatId?.startsWith(where.chatId.startsWith)
  ) return false
  if (where.id?.in && !where.id.in.includes(row.id)) return false
  if (typeof where.id === 'string' && row.id !== where.id) return false
  if (where.caseId?.in && !where.caseId.in.includes(row.caseId)) return false
  if (typeof where.caseId === 'string' && row.caseId !== where.caseId) return false
  if (where.agentConfigId?.in && !where.agentConfigId.in.includes(row.agentConfigId)) return false
  if (typeof where.agentConfigId === 'string' && row.agentConfigId !== where.agentConfigId) return false
  if (where.internalCaseId?.in && !where.internalCaseId.in.includes(row.internalCaseId)) return false
  if (where.internalCaseId?.not === null && row.internalCaseId == null) return false
  if (where.metadata?.path?.[0] === 'agentConfigId' && row.metadata?.agentConfigId !== where.metadata.equals) return false
  return true
}

function createRepo(overrides: {
  cases?: Array<Record<string, any>>
  runs?: Array<Record<string, any>>
  messages?: Array<Record<string, any>>
  traces?: Array<Record<string, any>>
  humanTasks?: Array<Record<string, any>>
  externalConversations?: Array<Record<string, any>>
} = {}) {
  const cases = overrides.cases ?? [baseCase]
  const runs = overrides.runs ?? [baseRun]
  const messages = overrides.messages ?? []
  const traces = overrides.traces ?? []
  const humanTasks = overrides.humanTasks ?? []
  const externalConversations = overrides.externalConversations ?? []

  return {
    orgId: 'org-1',
    raw: {
      case: {
        findMany: vi.fn(async (args: any) => cases.filter((row) => matchesWhere(row, args?.where))),
        findFirst: vi.fn(async (args: any) => cases.find((row) => matchesWhere(row, args?.where)) ?? null),
      },
      procedureRun: {
        findMany: vi.fn(async (args: any) => runs.filter((row) => matchesWhere(row, args?.where))),
      },
      message: {
        findMany: vi.fn(async (args: any) => messages.filter((row) => matchesWhere(row, args?.where))),
      },
      actionTrace: {
        findMany: vi.fn(async (args: any) => traces.filter((row) => matchesWhere(row, args?.where))),
      },
      humanTask: {
        findMany: vi.fn(async (args: any) => humanTasks.filter((row) => matchesWhere(row, args?.where))),
      },
      tool: {
        findMany: vi.fn(async () => [{ name: 'get_latest_deposit', mode: 'http', toolCategory: 'operational' }]),
      },
      knowledgeSource: {
        findMany: vi.fn(async () => [{ name: 'Deposit FAQ' }]),
      },
    },
    externalConversation: {
      findFirst: vi.fn(async (args: any) => externalConversations.find((row) => matchesWhere(row, args?.where)) ?? null),
      findMany: vi.fn(async (args: any) => externalConversations.filter((row) => matchesWhere(row, args?.where))),
    },
    agentConfig: {
      findUnique: vi.fn(async () => ({
        id: 'agent-1',
        name: 'J1N',
        version: 1,
        isActive: true,
        model: 'claude-test',
      })),
    },
  } as any
}

describe('buildChatForensicPack', () => {
  it('keeps only customer-visible transcript rows', async () => {
    const repo = createRepo({
      messages: [
        {
          id: 'msg-1',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          role: 'user',
          content: 'My deposit is missing',
          createdAt: new Date('2026-06-26T00:00:02.000Z'),
        },
        {
          id: 'msg-internal',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          role: 'user',
          content: '',
          providerContent: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'internal tool result' }],
          providerMeta: { visibility: 'internal', transcriptKind: 'tool_result' },
          createdAt: new Date('2026-06-26T00:00:03.000Z'),
        },
        {
          id: 'msg-2',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          role: 'assistant',
          content: 'I will check that deposit.',
          createdAt: new Date('2026-06-26T00:00:05.000Z'),
        },
      ],
    })

    const pack = await buildChatForensicPack({ repo, agentId: 'agent-1', chatId: 'chat-1' })

    expect(pack.transcript.messages.map((message) => message.content)).toEqual([
      'My deposit is missing',
      'I will check that deposit.',
    ])
    expect(pack.transcript.omittedInternalMessages).toBe(1)
    expect(pack.transcript.messages.every((message) => message.attribution.status === 'procedure_run')).toBe(true)
  })

  it('marks LiveChat metadata and playground-prefix attribution without guessing', async () => {
    const liveCase = { ...baseCase, id: 'case-live', chatId: 'live-chat' }
    const playgroundCase = { ...baseCase, id: 'case-pg', chatId: 'pg_agent-1_123' }
    const repo = createRepo({
      cases: [liveCase, playgroundCase],
      runs: [{ ...baseRun, id: 'legacy-run', caseId: 'case-pg', chatId: 'pg_agent-1_123', agentConfigId: 'unknown' }],
      externalConversations: [{
        orgId: 'org-1',
        internalCaseId: 'case-live',
        platform: 'livechat',
        externalChatId: 'lc-1',
        status: 'active',
        metadata: { agentConfigId: 'agent-1' },
      }],
    })

    const livePack = await buildChatForensicPack({ repo, agentId: 'agent-1', chatId: 'live-chat' })
    const playgroundPack = await buildChatForensicPack({ repo, agentId: 'agent-1', chatId: 'pg_agent-1_123' })

    expect(livePack.cases[0]?.attribution.status).toBe('livechat_metadata')
    expect(livePack.cases[0]?.attribution.confidence).toBe('high')
    expect(playgroundPack.cases[0]?.attribution.status).toBe('playground_prefix')
    expect(playgroundPack.procedureRuns[0]?.attribution.status).toBe('playground_prefix')
  })

  it('rejects no-run LiveChat direct-answer cases stamped for a different agent', async () => {
    const repo = createRepo({
      cases: [{
        ...baseCase,
        id: 'case-foreign',
        chatId: 'livechat-foreign-agent',
      }],
      runs: [],
      messages: [{
        id: 'msg-foreign',
        orgId: 'org-1',
        caseId: 'case-foreign',
        chatId: 'livechat-foreign-agent',
        runId: null,
        role: 'user',
        content: 'foreign transcript should not leak',
        createdAt: new Date('2026-06-26T00:00:02.000Z'),
      }],
      traces: [{
        id: 'trace-foreign',
        orgId: 'org-1',
        caseId: 'case-foreign',
        chatId: 'livechat-foreign-agent',
        runId: null,
        actionType: 'tool_result',
        title: 'Tool result: get_latest_deposit',
        detail: null,
        payload: JSON.stringify({
          toolName: 'get_latest_deposit',
          output: 'foreign evidence should not leak',
        }),
        createdAt: new Date('2026-06-26T00:00:04.000Z'),
      }],
      externalConversations: [{
        orgId: 'org-1',
        internalCaseId: 'case-foreign',
        platform: 'livechat',
        externalChatId: 'lc-foreign',
        status: 'active',
        metadata: { agentConfigId: 'agent-b' },
      }],
    })

    await expect(buildChatForensicPack({
      repo,
      agentId: 'agent-a',
      chatId: 'livechat-foreign-agent',
    })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('excludes null-run sibling evidence when a scoped case has selected agent run ids', async () => {
    const repo = createRepo({
      runs: [
        baseRun,
        {
          ...baseRun,
          id: 'legacy-run-sibling',
          agentConfigId: 'unknown',
          procedureId: 'legacy_procedure_should_not_leak',
        },
      ],
      messages: [
        {
          id: 'msg-selected',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          role: 'user',
          content: 'selected transcript stays',
          createdAt: new Date('2026-06-26T00:00:02.000Z'),
        },
        {
          id: 'msg-null-run',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: null,
          role: 'assistant',
          content: 'NULL_RUN_TRANSCRIPT_SECRET should not leak',
          createdAt: new Date('2026-06-26T00:00:03.000Z'),
        },
      ],
      traces: [
        {
          id: 'trace-selected',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          actionType: 'tool_result',
          title: 'Tool result: get_latest_deposit',
          detail: null,
          payload: JSON.stringify({
            toolName: 'get_latest_deposit',
            output: { ok: true, status: 'matched' },
          }),
          createdAt: new Date('2026-06-26T00:00:04.000Z'),
        },
        {
          id: 'trace-null-run-tool',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: null,
          actionType: 'tool_result',
          title: 'Tool result: legacy_null_tool',
          detail: 'NULL_RUN_TIMELINE_DETAIL should not leak',
          payload: JSON.stringify({
            toolName: 'legacy_null_tool',
            output: 'NULL_RUN_TRACE_SECRET Authorization: Bearer null-run-secret',
          }),
          createdAt: new Date('2026-06-26T00:00:05.000Z'),
        },
        {
          id: 'trace-legacy-run-tool',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'legacy-run-sibling',
          actionType: 'tool_result',
          title: 'Tool result: legacy_run_tool',
          detail: 'LEGACY_RUN_TIMELINE_DETAIL should not leak',
          payload: JSON.stringify({
            toolName: 'legacy_run_tool',
            output: 'LEGACY_RUN_TRACE_SECRET Authorization: Bearer legacy-run-secret',
          }),
          createdAt: new Date('2026-06-26T00:00:06.000Z'),
        },
      ],
      humanTasks: [{
        id: 'task-null-run',
        orgId: 'org-1',
        caseId: 'case-1',
        chatId: 'chat-1',
        runId: null,
        queue: 'support',
        status: 'open',
        question: 'NULL_RUN_TASK_SECRET should not leak',
        notes: 'NULL_RUN_TASK_NOTE should not leak',
        createdAt: new Date('2026-06-26T00:00:06.000Z'),
        resolvedAt: null,
      }],
    })

    const pack = await buildChatForensicPack({ repo, agentId: 'agent-1', chatId: 'chat-1' })
    const json = JSON.stringify(pack)

    expect(pack.transcript.messages.map((message) => message.content)).toEqual(['selected transcript stays'])
    expect(pack.procedureRuns.map((run) => run.runId)).toEqual(['run-1'])
    expect(pack.evidence.tools.map((tool) => tool.name)).toEqual(['get_latest_deposit'])
    expect(pack.evidence.humanTasks).toHaveLength(0)
    expect(pack.evidence.timeline.map((event) => event.actionType)).toEqual(['tool_result'])
    expect(json).not.toContain('NULL_RUN_')
    expect(json).not.toContain('LEGACY_RUN_')
    expect(json).not.toContain('legacy-run-sibling')
    expect(json).not.toContain('legacy_procedure_should_not_leak')
    expect(json).not.toContain('legacy_null_tool')
    expect(json).not.toContain('legacy_run_tool')
    expect(json).not.toContain('null-run-secret')
    expect(json).not.toContain('legacy-run-secret')
  })

  it('keeps null-run evidence for scoped legacy cases with no selected agent run ids', async () => {
    const repo = createRepo({
      runs: [],
      messages: [{
        id: 'msg-legacy',
        orgId: 'org-1',
        caseId: 'case-1',
        chatId: 'chat-1',
        runId: null,
        role: 'user',
        content: 'legacy transcript stays',
        createdAt: new Date('2026-06-26T00:00:02.000Z'),
      }],
      traces: [{
        id: 'trace-legacy',
        orgId: 'org-1',
        caseId: 'case-1',
        chatId: 'chat-1',
        runId: null,
        actionType: 'tool_result',
        title: 'Tool result: get_latest_deposit',
        detail: null,
        payload: JSON.stringify({
          toolName: 'get_latest_deposit',
          output: { ok: true, status: 'legacy_checked' },
        }),
        createdAt: new Date('2026-06-26T00:00:04.000Z'),
      }],
      humanTasks: [{
        id: 'task-legacy',
        orgId: 'org-1',
        caseId: 'case-1',
        chatId: 'chat-1',
        runId: null,
        queue: 'support',
        status: 'open',
        question: 'legacy task stays',
        notes: null,
        createdAt: new Date('2026-06-26T00:00:06.000Z'),
        resolvedAt: null,
      }],
      externalConversations: [{
        orgId: 'org-1',
        internalCaseId: 'case-1',
        platform: 'livechat',
        externalChatId: 'lc-legacy',
        status: 'active',
        metadata: { agentConfigId: 'agent-1' },
      }],
    })

    const pack = await buildChatForensicPack({ repo, agentId: 'agent-1', chatId: 'chat-1' })

    expect(pack.transcript.messages.map((message) => message.content)).toEqual(['legacy transcript stays'])
    expect(pack.evidence.tools.map((tool) => tool.name)).toEqual(['get_latest_deposit'])
    expect(pack.evidence.humanTasks.map((task) => task.question)).toEqual(['legacy task stays'])
    expect(pack.evidence.timeline.map((event) => event.actionType)).toEqual(['tool_result'])
  })

  it('summarizes evidence without leaking provider/debug payloads or raw backend ids', async () => {
    const repo = createRepo({
      messages: [{
        id: 'msg-1',
        orgId: 'org-1',
        caseId: 'case-1',
        chatId: 'chat-1',
        runId: 'run-1',
        role: 'assistant',
        content: 'Visible assistant answer',
        providerContent: [{ type: 'text', text: 'provider hidden copy' }],
        providerMeta: { providerFamily: 'anthropic', visibility: 'customer' },
        createdAt: new Date('2026-06-26T00:00:02.000Z'),
      }],
      traces: [
        {
          id: 'trace-prompt',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          actionType: 'llm_request_start',
          title: 'LLM request: claude-test',
          detail: null,
          payload: JSON.stringify({
            model: 'claude-test',
            systemPrompt: 'FULL INTERNAL SYSTEM PROMPT',
            messages: [{ role: 'user', content: 'hidden provider transcript' }],
            tools: [{ name: 'get_latest_deposit', input_schema: { secret: true } }],
          }),
          createdAt: new Date('2026-06-26T00:00:01.000Z'),
        },
        {
          id: 'trace-tool-result',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          actionType: 'tool_result',
          title: 'Tool result: kb_search_deposit',
          detail: null,
          payload: JSON.stringify({
            toolName: 'kb_search_deposit',
            input: { query: 'deposit help', group_ids: ['group-raw-id'] },
            output: {
              list: [{
                data_id: 'data-raw-id',
                chunk_id: 'chunk-raw-id',
                document_name: 'Deposit FAQ',
                score: 0.93,
                content: 'Deposits usually post after confirmation.',
              }],
            },
          }),
          createdAt: new Date('2026-06-26T00:00:04.000Z'),
        },
        {
          id: 'trace-response',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          actionType: 'llm_response',
          title: 'LLM response: end_turn',
          detail: null,
          payload: JSON.stringify({
            model: 'claude-test',
            usage: { input_tokens: 12, output_tokens: 8 },
            textPreview: 'debug preview should not be copied from payload',
          }),
          createdAt: new Date('2026-06-26T00:00:05.000Z'),
        },
      ],
    })

    const pack = await buildChatForensicPack({ repo, agentId: 'agent-1', chatId: 'chat-1' })
    const json = JSON.stringify(pack)

    expect(pack.evidence.knowledge[0]).toMatchObject({
      toolName: 'kb_search_deposit',
      query: 'deposit help',
      hitCount: 1,
      documents: [{ title: 'Deposit FAQ', score: 0.93 }],
    })
    expect(pack.metrics.usage.totalTokens).toBe(20)
    expect(json).not.toContain('"providerContent":')
    expect(json).not.toContain('"providerMeta":')
    expect(json).not.toContain('provider hidden copy')
    expect(json).not.toContain('FULL INTERNAL SYSTEM PROMPT')
    expect(json).not.toContain('hidden provider transcript')
    expect(json).not.toContain('input_schema')
    expect(json).not.toContain('group-raw-id')
    expect(json).not.toContain('data-raw-id')
    expect(json).not.toContain('chunk-raw-id')
    expect(json).not.toContain('debug preview')
  })

  it('summarizes Tool result and error strings without leaking raw backend payload fragments', async () => {
    const repo = createRepo({
      traces: [
        {
          id: 'trace-tool-error',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          actionType: 'tool_result',
          title: 'Tool result: get_latest_deposit',
          detail: null,
          payload: JSON.stringify({
            toolName: 'get_latest_deposit',
            error: 'Authorization: Bearer raw-secret-token for backend_user_id=be_123 group_id=grp_456',
          }),
          createdAt: new Date('2026-06-26T00:00:04.000Z'),
        },
        {
          id: 'trace-tool-output',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          actionType: 'tool_result',
          title: 'Tool result: get_latest_deposit',
          detail: null,
          payload: JSON.stringify({
            toolName: 'get_latest_deposit',
            output: {
              ok: false,
              message: 'raw provider API fragment backend_user_id=be_789 Authorization=Bearer secret-like-value',
              backend_user_id: 'be_789',
              group_id: 'grp_999',
              Authorization: 'Bearer raw-output-secret',
              status: 'provider_id=prov_456 failed',
              retryable: true,
            },
          }),
          createdAt: new Date('2026-06-26T00:00:05.000Z'),
        },
        {
          id: 'trace-tool-string',
          orgId: 'org-1',
          caseId: 'case-1',
          chatId: 'chat-1',
          runId: 'run-1',
          actionType: 'tool_result',
          title: 'Tool result: get_latest_deposit',
          detail: null,
          payload: JSON.stringify({
            toolName: 'get_latest_deposit',
            output: 'backend_user_id=be_555 group_id=grp_555 Authorization: Bearer string-secret',
          }),
          createdAt: new Date('2026-06-26T00:00:06.000Z'),
        },
      ],
    })

    const pack = await buildChatForensicPack({ repo, agentId: 'agent-1', chatId: 'chat-1' })
    const json = JSON.stringify(pack)

    expect(pack.evidence.tools[0]?.errors).toBe(2)
    expect(pack.evidence.tools[0]?.outputSummary).toMatch(/Text result \(\d+ chars\)|Failure result/)
    expect(pack.evidence.timeline.map((event) => event.summary).join('\n')).toContain('Error present')
    expect(json).not.toContain('backend_user_id')
    expect(json).not.toContain('group_id')
    expect(json).not.toContain('Authorization')
    expect(json).not.toContain('Bearer')
    expect(json).not.toContain('raw-secret-token')
    expect(json).not.toContain('raw-output-secret')
    expect(json).not.toContain('secret-like-value')
    expect(json).not.toContain('provider_id')
    expect(json).not.toContain('raw provider API fragment')
  })

  it('drops unknown trace detail and payload text that may contain provider secrets', async () => {
    const futureSecret = ['future', 'secret'].join('-')
    const payloadSecret = ['payload', 'secret'].join('-')
    const repo = createRepo({
      traces: [{
        id: 'trace-future-debug',
        orgId: 'org-1',
        caseId: 'case-1',
        chatId: 'chat-1',
        runId: 'run-1',
        actionType: 'future_provider_debug',
        title: 'Future provider debug',
        detail: `Authorization: Bearer ${futureSecret} provider_trace_id=ptr_detail_123`,
        payload: JSON.stringify({
          diagnostic: `Authorization: Bearer ${payloadSecret} provider_trace_id=ptr_payload_456`,
          provider_trace_id: 'ptr_payload_456',
        }),
        createdAt: new Date('2026-06-26T00:00:07.000Z'),
      }],
    })

    const pack = await buildChatForensicPack({ repo, agentId: 'agent-1', chatId: 'chat-1' })
    const json = JSON.stringify(pack)

    expect(pack.evidence.timeline.map((event) => event.actionType)).not.toContain('future_provider_debug')
    expect(json).not.toContain('Authorization')
    expect(json).not.toContain('Bearer')
    expect(json).not.toContain('provider_trace_id')
    expect(json).not.toContain(futureSecret)
    expect(json).not.toContain(payloadSecret)
    expect(json).not.toContain('ptr_detail_123')
    expect(json).not.toContain('ptr_payload_456')
  })
})
