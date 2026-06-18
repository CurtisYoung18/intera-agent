// Intera Harness - CaseAgentLoop
// Case-specific execution engine after the foundation reset:
// one main case owner, typed Procedure prompts, Hook checkpoints, and terminal
// case tool handling. The customer path stays inline.

import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Message, SSEEvent, CaseSchemaConfig } from '@intera/shared/types'
import { prisma } from '@intera/shared/prisma'
import { ProcedureExecutor } from './procedure-executor'
import type { ChatMemoryManager } from './memory'
import type { HookEngine } from './hook-engine'
import type { TraceWriter } from './trace'
import type { ToolRouter } from './tools'
import { unwrapToolExecutionPayload, type ToolExecutionResult } from './streaming-tool-executor'
import type { AgentConfigData, CaseStatus } from '@intera/shared/types'
import type { LoopResult } from './loop'
import { getActiveProcedureRun, recordProcedureToolResult } from './session-store'
import {
  HUMAN_TASK_CREATE_FAILED_MESSAGE,
  HUMAN_TASK_CREATE_FAILED_PROGRESS,
} from './human-task-errors'

export interface CaseLoopServices {
  caseId: string
  orgId: string
  agentConfigId: string
  userId: string
  chatId?: string | null
  config: AgentConfigData
  chatMemory: ChatMemoryManager
  getHookEngine: () => HookEngine
  traceWriter: TraceWriter
  toolRouter: ToolRouter
  getMessages: () => Message[]
  addMessage: (msg: Message) => void
  makeUserMessage: (content: string) => Message
}

export type CaseToolResult =
  | { type: 'none' }
  | { type: 'continue' }
  | { type: 'terminal'; result: LoopResult }

export class CaseAgentLoop {
  private procedureExecutor: ProcedureExecutor | null = null
  private _currentStage: CaseStatus

  constructor(
    private readonly caseSchema: CaseSchemaConfig,
    private readonly services: CaseLoopServices,
    _bootstrapNewCase?: boolean,
  ) {
    if (caseSchema.procedure && caseSchema.procedure.steps.length > 0) {
      const knowledgeToolNames = new Set(
        this.services.toolRouter
          .getToolDefinitions()
          .filter((tool) => !!tool.knowledgeSourceId)
          .map((tool) => tool.name),
      )
      this.procedureExecutor = new ProcedureExecutor(caseSchema.procedure, caseSchema.type, knowledgeToolNames)
    }
    this._currentStage = this.readCaseStatus()
  }

  get currentStage(): string {
    return this._currentStage
  }

  getStopProcedureStepIds(): string[] {
    const activeRun = getActiveProcedureRun(this.services.caseId)
    if (!activeRun) return []
    const current = activeRun.currentStepId ? [activeRun.currentStepId] : []
    const completed = activeRun.steps
      .filter((step) => step.status === 'completed')
      .map((step) => step.id)
    return [...new Set([...current, ...completed])]
  }

  isStageActive(): boolean {
    return this._currentStage !== 'resolved'
  }

  syncStage(): void {
    this._currentStage = this.readCaseStatus()
  }

  isProcedureMode(): boolean {
    return this.procedureExecutor !== null
  }

  procedureRequiredTools(): string[] {
    return this.procedureExecutor?.requiredTools() ?? []
  }

  buildProcedurePrompt(): string {
    if (!this.procedureExecutor) {
      return [
        `Procedure type: ${this.caseSchema.type}`,
        'No configured Procedure steps. Ask concise clarifying questions or escalate with create_human_task if needed.',
      ].join('\n')
    }
    return this.procedureExecutor.buildDefinitionPrompt()
  }

  filterProcedureTools(allTools: Tool[]): Tool[] {
    return allTools
  }

  emitProgressEvent(iterationCount: number, sendEvent: (event: SSEEvent) => void): void {
    sendEvent({
      type: 'core_agent_progress',
      data: {
        stage: this._currentStage,
        iteration: iterationCount,
        task: `procedure · iter ${iterationCount}`,
      },
      timestamp: new Date().toISOString(),
    })
  }

  async handleCaseTerminalTools(
    toolResults: ToolExecutionResult[],
    iterationCount: number,
    _nudgeCount: { value: number },
    sendEvent: (event: SSEEvent) => void,
  ): Promise<CaseToolResult> {
    const humanTaskResult = toolResults.find((result) => result.name === 'create_human_task')
    if (humanTaskResult) {
      return this.handleCreateHumanTask(humanTaskResult, iterationCount, sendEvent)
    }

    const finalizeResult = toolResults.find((result) => result.name === 'finalize_procedure')
    if (finalizeResult) {
      return this.handleFinalizeCase(finalizeResult, sendEvent)
    }

    const consultResult = toolResults.find((result) => result.name === 'finalize_consultation')
    if (consultResult) {
      return this.handleFinalizeConsultation(consultResult, sendEvent)
    }

    return { type: 'none' }
  }

  private readCaseStatus(): CaseStatus {
    const status = this.services.chatMemory.getSummary().caseStatus
    if (
      status === 'created' ||
      status === 'collecting' ||
      status === 'investigating' ||
      status === 'waiting_human' ||
      status === 'resolved' ||
      status === 'escalated'
    ) {
      return status
    }
    return 'investigating'
  }

  private buildHitCounts(): Map<string, number> {
    const counts = new Map<string, number>()
    const hookEngine = this.services.getHookEngine()
    for (const name of hookEngine.getHookNames()) {
      const count = this.services.chatMemory.getHookHitCount(name)
      if (count > 0) counts.set(name, count)
    }
    return counts
  }

  private async handleCreateHumanTask(
    humanTaskResult: ToolExecutionResult,
    iterationCount: number,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<CaseToolResult> {
    const toolInput = humanTaskResult.toolUse?.input || {}
    const queue = String(toolInput.queue || 'general')
    const question = String(toolInput.question || 'Human task requested')
    const taskFields = toolInput.fields as Array<Record<string, unknown>> | undefined

    const { caseId, orgId, userId, chatId } = this.services
    let taskId: string | null = null

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await prisma.organization.upsert({
          where: { id: orgId },
          update: {},
          create: { id: orgId, name: orgId },
        })

        await prisma.case.upsert({
          where: { id: caseId },
          update: { status: 'waiting_human', blocker: `Waiting for ${queue}` },
          create: {
            id: caseId,
            orgId,
            userId,
            type: this.caseSchema.type || 'general',
            status: 'waiting_human',
            blocker: `Waiting for ${queue}`,
            chatId: chatId ?? caseId,
          },
        })

        this.services.chatMemory.setCaseStatus('waiting_human')
        this.syncStage()

        await prisma.chatMemory.upsert({
          where: { caseId },
          update: { ...this.services.chatMemory.getDbFields(), humanTaskStatus: 'pending' },
          create: { caseId, ...this.services.chatMemory.getDbFields(), humanTaskStatus: 'pending' },
        })

        const task = await prisma.humanTask.create({
          data: {
            caseId,
            queue,
            question,
            fields: taskFields && taskFields.length > 0 ? JSON.stringify(taskFields) : null,
            status: 'pending',
          },
        })
        taskId = task.id

        await this.services.traceWriter.writeHumanTaskCreated(task.id, queue)
        humanTaskResult.output = {
          ok: true,
          output: { taskId: task.id, queue, status: 'pending', persisted: true },
          latencyMs: humanTaskResult.latencyMs,
        }
        if (humanTaskResult.toolUse) {
          humanTaskResult.toolUse.result = humanTaskResult.output as any
          humanTaskResult.toolUse.status = 'completed'
        }
        recordProcedureToolResult(this.services.caseId, {
          toolName: humanTaskResult.name,
          toolUseId: humanTaskResult.toolUse?.id,
          toolOutput: { taskId: task.id, queue, status: 'pending', persisted: true },
        })
        sendEvent({
          type: 'tool_result',
          data: {
            name: humanTaskResult.name,
            status: 'completed',
            result: humanTaskResult.output,
          },
          timestamp: new Date().toISOString(),
        })
        await this.services.traceWriter.write(
          'tool_result',
          `Tool: ${humanTaskResult.name}`,
          {
            toolName: humanTaskResult.name,
            output: { taskId: task.id, queue, status: 'pending', persisted: true },
            iteration: iterationCount,
          },
        )

        const messages = this.services.getMessages()
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (
            message.role === 'assistant' &&
            typeof message.content === 'string' &&
            message.content.startsWith('Tool create_human_task result:')
          ) {
            message.content = `Tool create_human_task result: ${JSON.stringify({ taskId: task.id, queue, status: 'pending' })}`
            break
          }
        }

        sendEvent({
          type: 'human_task_created',
          data: { taskId: task.id, queue, status: 'pending' },
          timestamp: new Date().toISOString(),
        })
        await this.services.traceWriter.writeEscalated('human_task_created', { taskId: task.id, queue })
        sendEvent({
          type: 'escalated',
          data: { reason: 'human_task_created', taskId: task.id, queue },
          timestamp: new Date().toISOString(),
        })
        break
      } catch (err) {
        console.error(`[CaseAgentLoop] Failed to persist human task (attempt ${attempt}/3):`, err)
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 200))
      }
    }

    if (!taskId) {
      humanTaskResult.output = {
        ok: false,
        output: null,
        error: HUMAN_TASK_CREATE_FAILED_MESSAGE,
        latencyMs: humanTaskResult.latencyMs,
      }
      if (humanTaskResult.toolUse) {
        humanTaskResult.toolUse.result = humanTaskResult.output as any
        humanTaskResult.toolUse.status = 'error'
      }
      recordProcedureToolResult(this.services.caseId, {
        toolName: humanTaskResult.name,
        toolUseId: humanTaskResult.toolUse?.id,
        toolError: HUMAN_TASK_CREATE_FAILED_MESSAGE,
      })
      sendEvent({
        type: 'tool_result',
        data: {
          name: humanTaskResult.name,
          status: 'error',
          result: humanTaskResult.output,
        },
        timestamp: new Date().toISOString(),
      })
      await this.services.traceWriter.write(
        'tool_result',
        `Tool: ${humanTaskResult.name}`,
        {
          toolName: humanTaskResult.name,
          error: HUMAN_TASK_CREATE_FAILED_MESSAGE,
          iteration: iterationCount,
        },
      )
      sendEvent({
        type: 'core_agent_progress',
        data: {
          stage: this._currentStage,
          iteration: iterationCount,
          task: HUMAN_TASK_CREATE_FAILED_PROGRESS,
        },
        timestamp: new Date().toISOString(),
      })
      return { type: 'continue' }
    }

    sendEvent({
      type: 'message_stop',
      data: { reason: 'waiting_human', stage: this._currentStage },
      timestamp: new Date().toISOString(),
    })

    return {
      type: 'terminal',
      result: {
        messages: this.services.getMessages(),
        caseStatus: 'waiting_human',
        transition: 'waiting_human',
        currentStage: this._currentStage,
        reason: 'human_task_created',
      },
    }
  }

  private async handleFinalizeCase(
    finalizeResult: ToolExecutionResult,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<CaseToolResult> {
    const finalizedPayload = unwrapToolExecutionPayload(finalizeResult.output)
    if (
      finalizedPayload &&
      typeof finalizedPayload === 'object' &&
      !Array.isArray(finalizedPayload) &&
      (finalizedPayload as { ok?: boolean }).ok === false
    ) {
      this.services.addMessage(this.services.makeUserMessage('[PROCEDURE RUNTIME] Finalization was blocked. Review the latest customer messages and retry finalize_procedure using the current inputEpoch.'))
      return { type: 'continue' }
    }
    const stopEval = await this.services.getHookEngine().evaluate(
      'Stop',
      {
        checkpoint: 'Stop',
        agentConfigId: this.services.agentConfigId,
        caseId: this.services.caseId,
        chatId: this.services.chatId ?? undefined,
        caseType: {
          type: this.caseSchema.type,
          displayName: this.caseSchema.displayName,
        },
        procedureStepIds: this.getStopProcedureStepIds(),
        tool: {
          name: finalizeResult.name,
          input: finalizeResult.toolUse?.input,
          output: finalizedPayload,
        },
        caseFacts: this.services.chatMemory.getContextMap(),
        missingFacts: this.services.chatMemory.getMissingFacts(),
        previousToolCalls: this.services.chatMemory.getToolsCalled().map((name) => ({
          name,
          output: this.services.chatMemory.getToolResult(name),
        })),
        traceSummary: this.services.chatMemory.getKeyEvents().slice(-10).map((event) => ({
          at: event.at,
          text: event.text,
          source: event.source,
        })),
        replyDraft: typeof finalizedPayload === 'string' ? finalizedPayload : JSON.stringify(finalizedPayload),
        metadata: {
          currentStage: this._currentStage,
          terminalTool: finalizeResult.name,
        },
      },
      this.buildHitCounts(),
    )

    if (stopEval.summary === 'block' || stopEval.summary === 'escalate') {
      for (const result of stopEval.results) {
        if (result.action !== 'allow') this.services.chatMemory.recordHookHit(result.hookName)
      }
      await this.services.traceWriter.write(
        'loop_decision',
        'Finalize blocked by Stop Hook',
        stopEval as unknown as Record<string, unknown>,
      )
      sendEvent({
        type: 'error',
        data: `Finalize blocked by Stop Hook: ${stopEval.results
          .filter((result) => result.action === 'block' || result.action === 'escalate')
          .map((result) => result.hookName)
          .join(', ')}`,
        timestamp: new Date().toISOString(),
      })
      if (stopEval.feedbackMessage) {
        this.services.addMessage(this.services.makeUserMessage(stopEval.feedbackMessage))
      }
      return { type: 'continue' }
    }

    await this.services.traceWriter.writeFinalResolution('resolved', JSON.stringify(finalizedPayload))

    try {
      await prisma.case.update({
        where: { id: this.services.caseId },
        data: { status: 'resolved', resolvedAt: new Date(), blocker: null },
      })
      this.services.chatMemory.setCaseStatus('resolved')
      this.syncStage()
    } catch (err) {
      console.error('[CaseAgentLoop] Failed to persist case resolution:', err)
    }

    sendEvent({ type: 'finalized', data: finalizedPayload, timestamp: new Date().toISOString() })
    return {
      type: 'terminal',
      result: {
        messages: this.services.getMessages(),
        caseStatus: 'resolved',
        transition: 'resolved',
        currentStage: this._currentStage,
      },
    }
  }

  private async handleFinalizeConsultation(
    consultResult: ToolExecutionResult,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<CaseToolResult> {
    const toolInput = (consultResult.toolUse?.input || {}) as Record<string, unknown>
    const output = unwrapToolExecutionPayload(consultResult.output) as Record<string, unknown> | undefined
    const summary = String(toolInput.summary || output?.summary || 'Your case has been reviewed by our specialist.')
    const resolution = String(toolInput.resolution || output?.resolution || 'resolved')

    await this.services.traceWriter.write('final_resolution', `Consultation complete: ${resolution}`, output ?? {})

    try {
      await prisma.case.update({
        where: { id: this.services.caseId },
        data: { status: 'investigating', blocker: null },
      })
      await prisma.humanTask.updateMany({
        where: { caseId: this.services.caseId, status: 'in_progress' },
        data: { status: 'resolved', verdict: resolution, notes: summary },
      })
      this.services.chatMemory.setCaseStatus('investigating')
      this.syncStage()
    } catch (err) {
      console.error('[CaseAgentLoop] Failed to finalize consultation:', err)
    }

    sendEvent({
      type: 'consultation_complete',
      data: { summary, resolution },
      timestamp: new Date().toISOString(),
    })
    return {
      type: 'terminal',
      result: {
        messages: this.services.getMessages(),
        caseStatus: 'investigating',
        transition: 'consultation_complete',
        currentStage: this._currentStage,
      },
    }
  }
}
