import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

const inputSchema = z.object({
  queue: z.string().describe('Human queue to route to'),
  question: z.string().describe('Structured question for human'),
  known_facts: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Compact facts already collected for the operator handoff note'),
  chat_summary: z.string().optional().describe('Short chat summary for the operator handoff note'),
  handoff_reason: z.string().optional().describe('Why a human is needed'),
})

type Input = z.infer<typeof inputSchema>
type Output = { taskId: string; status: 'pending' }

export const createHumanTaskTool: Tool<Input, Output> = {
  name: 'create_human_task',
  source: 'builtin',
  inputSchema,
  guardPhase: 'post',
  displayVerb: { text: 'Escalating to a specialist', icon: 'pulse' },

  async prompt(_ctx: ToolContext) {
    return 'Create a human task for manual confirmation or processing. ' +
      'Call this when a human must take over; do not only promise a transfer in plain text. ' +
      'A successful persisted handoff finalizes the active ProcedureRun on every channel, ' +
      'even if the outer case or chat remains waiting_human for operator work. ' +
      'When useful, use known_facts, chat_summary, and handoff_reason to pass a concise note for the human operator. ' +
      'Focus on customer identifiers, contact details, collected payment/account facts, what the customer needs, why a human is needed, and the suggested next step. ' +
      'Do not include internal tool names, hook names, procedure IDs, case IDs, run IDs, model details, or runtime implementation details. ' +
      'Write the note in the same support language required by the active system prompt. ' +
      'Optionally provide structured fields to collect specific data from the operator — ' +
      'their answers return as structured runtime input when they resolve the task.'
  },

  isEnabled() { return true },
  isConcurrencySafe(_input: Input) { return false },
  isReadOnly(_input: Input) { return false },

  async call(input: Input, ctx: ToolContext): Promise<Output> {
    const { prisma } = await import('@intera/shared/prisma')
    const [caseRow, activeRun] = await Promise.all([
      prisma.case.findUnique({
        where: { id: ctx.caseId },
        select: { orgId: true, chatId: true },
      }).catch(() => null),
      prisma.procedureRun.findFirst({
        where: { caseId: ctx.caseId, status: { in: ['active', 'paused'] } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }).catch(() => null),
    ])

    const existing = await prisma.humanTask.findFirst({
      where: { caseId: ctx.caseId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }).catch(() => null)
    if (existing?.id) {
      await prisma.case.update({
        where: { id: ctx.caseId },
        data: { status: 'waiting_human' },
      }).catch(() => null)
      return { taskId: existing.id, status: 'pending' }
    }

    const task = await prisma.humanTask.create({
      data: {
        caseId: ctx.caseId,
        orgId: ctx.orgId || caseRow?.orgId || 'default',
        chatId: caseRow?.chatId || ctx.caseId,
        runId: activeRun?.id ?? null,
        queue: input.queue,
        question: input.question,
        status: 'pending',
      },
    })

    // Update case status to waiting_human
    await prisma.case.update({
      where: { id: ctx.caseId },
      data: { status: 'waiting_human' },
    })

    return { taskId: task.id, status: 'pending' }
  },
}

registerBuiltin(createHumanTaskTool)
