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
  | 'fact_extracted'
  | 'hook_hit'
  | 'tool_call'
  | 'tool_result'
  | 'human_task_created'
  | 'human_task_resolved'
  | 'final_resolution'
  | 'cron_tick'
  | 'loop_decision'
  | 'stream_event'
  | 'llm_request_start'
  | 'llm_response'
  | 'microcompact'
  // ── LiveChat / multi-agent trace ──
  | 'incoming_chat'
  | 'chat_deactivated'
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
  actionType: ActionType
  title: string
  detail?: string
  payload?: Record<string, unknown>
  createdAt: Date
}

export class TraceWriter {
  private chatId: string | null = null

  constructor(private caseId: string, private persistence: PersistencePort) {}

  /** Set the chatId for all subsequent trace writes. */
  setChatId(chatId: string | null): void {
    this.chatId = chatId
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

    // Single seam: prod → Prisma, playground → in-memory. Fire-and-forget (never block the loop).
    this.persistence.saveTrace({
      id: entry.id,
      caseId: entry.caseId,
      chatId: this.chatId,
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
  ): Promise<void> {
    await this.write('human_task_created', 'Human task created', {
      taskId,
      queue,
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
  ): Promise<void> {
    const payload: Record<string, unknown> = { model, messageCount }
    if (systemPrompt) {
      payload.systemPrompt = systemPrompt.length > 8000
        ? systemPrompt.slice(0, 8000) + `\n\n... [truncated ${systemPrompt.length - 8000} chars]`
        : systemPrompt
    }
    if (messages) {
      const lastMsgs = messages.slice(-6)
      payload.lastMessages = lastMsgs.map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? (m.content.length > 2000 ? m.content.slice(0, 2000) + '...' : m.content)
          : '[non-text]',
      }))
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
