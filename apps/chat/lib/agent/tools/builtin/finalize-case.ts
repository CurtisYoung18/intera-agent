import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

const inputSchema = z.object({
  conclusion: z.string().optional().describe('Conclusion summary'),
})

type Input = z.infer<typeof inputSchema>
type Output = { status: 'resolved' }

export const finalizeCaseTool: Tool<Input, Output> = {
  name: 'finalize_case',
  source: 'builtin',
  inputSchema,
  guardPhase: 'post',
  displayVerb: { text: 'Wrapping up your case', icon: 'spin' },

  async prompt(_ctx: ToolContext) {
    return 'Mark the case as resolved with a conclusion'
  },

  isEnabled() { return true },
  isConcurrencySafe(_input: Input) { return false },
  isReadOnly(_input: Input) { return false },

  async call(input: Input, ctx: ToolContext): Promise<Output> {
    const { prisma } = await import('@intera/shared/prisma')

    await prisma.case.update({
      where: { id: ctx.caseId },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
      },
    })

    // If a conclusion was provided, add it as a message
    if (input.conclusion) {
      await prisma.message.create({
        data: {
          caseId: ctx.caseId,
          role: 'assistant',
          content: `Case resolved. Conclusion: ${input.conclusion}`,
        },
      })
    }

    return { status: 'resolved' }
  },
}

registerBuiltin(finalizeCaseTool)
