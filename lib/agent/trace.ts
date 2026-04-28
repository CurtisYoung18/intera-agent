// Intera Harness - Trace Writer
// Based on architecture doc: Trace / 可观测性
//
// [MOCK] Logs to console. Production path:
//   - Write to ActionTrace table via Prisma
//   - Read by Case detail page for timeline display

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

export interface TraceEntry {
  id: string
  caseId: string
  actionType: ActionType
  title: string
  detail?: string
  payload?: Record<string, unknown>
  createdAt: Date
}

/**
 * Trace Writer — records all actions in a Case for observability.
 * Each trace entry is linked to a caseId and rendered in the Case
 * detail timeline.
 */
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

    // [MOCK] Console log. Production writes to DB:
    //   await prisma.actionTrace.create({ data: { ...entry } })
    console.log(
      `[Trace] ${actionType}: ${title}`,
      entry.payload || entry.detail || '',
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
}
