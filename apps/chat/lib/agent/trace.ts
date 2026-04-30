// Intera Harness - Trace Writer
// Based on architecture doc: Trace / 可观测性
//
// Writes all agent actions to ActionTrace table via Prisma.
// Fire-and-forget pattern: DB writes never block the agent loop.

import { prisma } from '@intera/shared/prisma'

export type ActionType =
  | 'user_message'
  | 'case_created'
  | 'fact_extracted'
  | 'policy_hit'
  | 'skill_called'
  | 'skill_result'
  | 'human_task_created'
  | 'human_task_resolved'
  | 'final_resolution'
  | 'cron_tick'
  | 'loop_decision'
  | 'stream_event'
  | 'llm_request_start'
  | 'llm_response'

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
  constructor(private caseId: string) {}

  async write(
    actionType: ActionType,
    title: string,
    detailOrPayload?: string | Record<string, unknown>,
  ): Promise<TraceEntry> {
    const entry: TraceEntry = {
      id: crypto.randomUUID(),
      caseId: this.caseId,
      actionType,
      title,
      createdAt: new Date(),
    }

    if (typeof detailOrPayload === 'string') {
      entry.detail = detailOrPayload
    } else if (detailOrPayload) {
      entry.payload = detailOrPayload as Record<string, unknown>
    }

    // Fire-and-forget: never block the agent loop on trace writes
    prisma.actionTrace
      .create({
        data: {
          caseId: entry.caseId,
          actionType: entry.actionType,
          title: entry.title,
          detail: entry.detail || null,
          payload: entry.payload ? JSON.stringify(entry.payload) : null,
        },
      })
      .catch((err) =>
        console.error(`[TraceWriter] DB write failed (${actionType}):`, err),
      )

    return entry
  }

  async writeSkillCall(
    skillName: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    await this.write('skill_called', `Skill called: ${skillName}`, {
      skillName,
      input,
    })
  }

  async writeSkillResult(
    skillName: string,
    output: unknown,
  ): Promise<void> {
    await this.write('skill_result', `Skill result: ${skillName}`, {
      skillName,
      output,
    })
  }

  async writePolicyHit(
    policyName: string,
    result: string,
    reason?: string,
  ): Promise<void> {
    await this.write('policy_hit', `Policy hit: ${policyName}`, {
      policyName,
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
  ): Promise<void> {
    await this.write('llm_request_start', `LLM request: ${model}`, {
      model,
      messageCount,
    })
  }

  async writeLlmResponse(
    stopReason: string | null,
    usage?: { input_tokens?: number; output_tokens?: number },
  ): Promise<void> {
    await this.write('llm_response', `LLM response: ${stopReason || 'complete'}`, {
      stopReason,
      usage,
    })
  }
}
