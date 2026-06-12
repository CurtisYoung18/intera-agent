import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

const inputSchema = z.object({
  queue: z.string().describe('Human queue to route to'),
  question: z.string().describe('Structured question for human'),
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
      'This will pause the agent loop until a human responds. ' +
      'Optionally provide structured fields to collect specific data from the operator — ' +
      'their answers return as structured runtime input when they resolve the task.'
  },

  isEnabled() { return true },
  isConcurrencySafe(_input: Input) { return false },
  isReadOnly(_input: Input) { return false },

  async call(input: Input, ctx: ToolContext): Promise<Output> {
    const { prisma } = await import('@intera/shared/prisma')

    const task = await prisma.humanTask.create({
      data: {
        caseId: ctx.caseId,
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
