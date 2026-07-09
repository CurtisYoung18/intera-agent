// Intera Harness - Trace Writer
// Based on architecture doc: Trace / 可观测性
//
// Writes all agent actions through the PersistencePort seam.
// Production → Prisma, Playground → in-memory. Fire-and-forget.
// Single contract: payload is JSON.stringify'd (matches Prisma column shape).

import type { PersistencePort } from './persistence-port'

export type ActionType =
  | 'user_message'
  | 'case_created'
  | 'escalated'
  | 'fact_extracted'
  | 'hook_hit'
  | 'tool_call'
  | 'tool_result'
  | 'form_request'
  | 'form_submit'
  | 'human_task_created'
  | 'human_task_resolved'
  | 'channel_rich_message'
  | 'final_resolution'
  | 'cron_tick'
  | 'loop_decision'
  | 'stream_event'
  | 'llm_request_start'
  | 'llm_response'
  | 'microcompact'
  | 'provider_transcript_health'
  | 'provider_transcript_persisted'
  | 'provider_transcript_repair'
  | 'provider_transcript_orphan_drop'
  | 'provider_transcript_legacy_skip'
  | 'provider_transcript_compact_summary'
  // ── LiveChat / multi-agent trace ──
  | 'incoming_chat'
  | 'chat_deactivated'
  | 'channel_transfer'
  | 'queue_message_enqueued'
  | 'queue_message_consumed'
  | 'agent_tree_node'
  | 'case_merged'

export function normalizeTraceActionType(actionType: string): ActionType | string {
  return actionType
}

export interface TraceEntry {
  id: string
  caseId: string
  runId?: string | null
  actionType: ActionType
  title: string
  detail?: string
  payload?: Record<string, unknown>
  createdAt: Date
}

function capTraceValue(value: unknown, maxChars: number): unknown {
  if (typeof value === 'string') {
    return value.length > maxChars
      ? {
          __trace_truncated: true,
          originalChars: value.length,
          preview: value.slice(0, maxChars),
        }
      : value
  }

  try {
    const json = JSON.stringify(value)
    if (json.length <= maxChars) return value
    return {
      __trace_truncated: true,
      originalChars: json.length,
      preview: json.slice(0, maxChars),
    }
  } catch {
    return String(value)
  }
}

export class TraceWriter {
  private chatId: string | null = null
  private runId: string | null = null
  private runIdProvider: (() => string | null | undefined) | null = null

  constructor(private caseId: string, private persistence: PersistencePort) {}

  /** Set the chatId for all subsequent trace writes. */
  setChatId(chatId: string | null): void {
    this.chatId = chatId
  }

  /** Set the active ProcedureRun id for subsequent trace writes. */
  setRunId(runId: string | null | undefined): void {
    this.runId = runId ?? null
  }

  /** Resolve the active ProcedureRun id at write time for same-turn attribution. */
  setRunIdProvider(provider: (() => string | null | undefined) | null): void {
    this.runIdProvider = provider
  }

  async write(
    actionType: ActionType,
    title: string,
    detailOrPayload?: string | Record<string, unknown>,
  ): Promise<TraceEntry> {
    const entry: TraceEntry = {
      id: crypto.randomUUID(),
      caseId: this.caseId,
      actionType: normalizeTraceActionType(actionType) as ActionType,
      title,
      createdAt: new Date(),
    }

    if (typeof detailOrPayload === 'string') {
      entry.detail = detailOrPayload
    } else if (detailOrPayload) {
      entry.payload = detailOrPayload as Record<string, unknown>
    }

    entry.runId = traceRunIdFromPayload(entry.payload)
      ?? this.runIdProvider?.()
      ?? this.runId
      ?? null

    // Single seam: prod → Prisma, playground → in-memory. Fire-and-forget (never block the loop).
    this.persistence.saveTrace({
      id: entry.id,
      caseId: entry.caseId,
      chatId: this.chatId,
      runId: entry.runId,
      actionType: entry.actionType,
      title: entry.title,
      detail: entry.detail ?? null,
      payload: entry.payload ? JSON.stringify(entry.payload) : null,
    }).catch((err) => console.error(`[TraceWriter] saveTrace failed (${entry.actionType}):`, err))

    return entry
  }

  async writeToolCall(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    await this.write('tool_call', `Tool called: ${toolName}`, {
      toolName,
      input,
    })
  }

  async writeToolResult(
    toolName: string,
    output: unknown,
  ): Promise<void> {
    await this.write('tool_result', `Tool result: ${toolName}`, {
      toolName,
      output,
    })
  }

  async writeHookHit(
    hookName: string,
    result: string,
    reason?: string,
  ): Promise<void> {
    await this.write('hook_hit', `Hook hit: ${hookName}`, {
      hookName,
      result,
      reason,
    })
  }

  async writeHumanTaskCreated(
    taskId: string,
    queue: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.write('human_task_created', 'Human task created', {
      taskId,
      queue,
      ...details,
    })
  }

  async writeEscalated(
    reason: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.write('escalated', 'Case escalated', {
      reason,
      ...payload,
    })
  }

  async writeFinalResolution(
    status: string,
    conclusion: string,
  ): Promise<void> {
    await this.write('final_resolution', `Case resolved: ${status}`, {
      status,
      conclusion,
    })
  }

  async writeLlmRequestStart(
    model: string,
    messageCount: number,
    systemPrompt?: string,
    messages?: unknown[],
    tools?: unknown[],
    toolChoice?: unknown,
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      model,
      messageCount,
      requestPayloadCaptured: true,
    }
    if (systemPrompt) {
      payload.systemPrompt = capTraceValue(systemPrompt, 60000)
    }
    if (messages) {
      payload.messages = capTraceValue(messages, 90000)
      payload.lastMessages = capTraceValue(messages.slice(-6), 30000)
    }
    if (tools) {
      payload.tools = capTraceValue(tools, 90000)
    }
    if (toolChoice) {
      payload.toolChoice = toolChoice
    }
    await this.write('llm_request_start', `LLM request: ${model}`, payload)
  }

  async writeLlmResponse(
    stopReason: string | null,
    usage?: Record<string, unknown>,
    iteration?: number,
    textContent?: string,
    toolNames?: string[],
    model?: string,
  ): Promise<void> {
    await this.write('llm_response', `LLM response: ${stopReason || 'complete'}`, {
      stopReason,
      iteration,
      usage,
      model,
      textPreview: textContent ? textContent.slice(0, 3000) : undefined,
      toolCalls: toolNames?.length ? toolNames : undefined,
    })
  }

  // ── LiveChat trace helpers ──

  async writeQueueEnqueued(queueDepth: number, messagePreview: string): Promise<void> {
    await this.write('queue_message_enqueued', `Message queued (depth: ${queueDepth})`, {
      queueDepth,
      messagePreview: messagePreview.slice(0, 200),
    })
  }

  async writeQueueConsumed(messageCount: number, iteration: number): Promise<void> {
    await this.write('queue_message_consumed', `Consumed ${messageCount} queued messages`, {
      messageCount,
      iteration,
    })
  }

  async writeAgentTreeNode(
    agentName: string,
    depth: number,
    chainId: string,
    detail: string,
  ): Promise<void> {
    await this.write('agent_tree_node', `[${agentName}] ${detail}`, {
      agentName,
      depth,
      chainId,
    })
  }

  async writeIncomingChat(platform: string, externalId: string): Promise<void> {
    await this.write('incoming_chat', `New chat: ${platform}/${externalId}`, {
      platform,
      externalId,
    })
  }

  async writeChatDeactivated(): Promise<void> {
    await this.write('chat_deactivated', 'Chat deactivated')
  }
}

function traceRunIdFromPayload(payload?: Record<string, unknown>): string | undefined {
  if (!payload) return undefined
  const runId = payload.runId
  return typeof runId === 'string' && runId.trim().length > 0 ? runId : undefined
}
