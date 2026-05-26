import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

const inputSchema = z.object({
  userId: z.string().describe('Customer user ID'),
  limit: z.number().optional().describe('Max number of cases to return (default 5)'),
})

type Input = z.infer<typeof inputSchema>
type Output = { cases: Array<{ id: string; type: string; status: string; summary: string | null; resolvedAt: string | null }> }

export const readCaseHistoryTool: Tool<Input, Output> = {
  name: 'read_case_history',
  source: 'builtin',
  inputSchema,
  guardPhase: 'post',
  displayVerb: { text: 'Looking up past cases', icon: 'scan' },

  async prompt(_ctx: ToolContext) {
    return "Read the customer's historical cases for context"
  },

  isEnabled() { return true },
  isConcurrencySafe(_input: Input) { return true },
  isReadOnly(_input: Input) { return true },

  async call(input: Input, ctx: ToolContext): Promise<Output> {
    const { prisma } = await import('@intera/shared/prisma')
    const take = input.limit ?? 5

    const cases = await prisma.case.findMany({
      where: {
        customerId: ctx.customerId,
        userId: input.userId,
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        type: true,
        status: true,
        resolvedAt: true,
        goal: true,
      },
    })

    return {
      cases: cases.map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        summary: c.goal,
        resolvedAt: c.resolvedAt?.toISOString() ?? null,
      })),
    }
  },
}

registerBuiltin(readCaseHistoryTool)
