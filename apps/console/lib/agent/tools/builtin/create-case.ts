import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

const inputSchema = z.object({
  caseType: z.string().describe('Case type slug (e.g. deposit_issue, account_issue)'),
})

type Input = z.infer<typeof inputSchema>
type Output = { caseId: string; status: 'created' }

export const dispatchCaseAgentTool: Tool<Input, Output> = {
  name: 'dispatch_case_agent',
  source: 'builtin',
  inputSchema,
  guardPhase: 'post',
  displayVerb: { text: 'Dispatching case agent', icon: 'dots' },

  async prompt(_ctx: ToolContext) {
    return 'Internal compatibility alias for start_procedure. Prefer start_procedure for new model-facing calls.'
  },

  isEnabled() { return true },
  isConcurrencySafe(_input: Input) { return false },
  isReadOnly(_input: Input) { return false },

  async call(input: Input, ctx: ToolContext): Promise<Output> {
    const { prisma } = await import('@intera/shared/prisma')
    const caseId = `case_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`

    await prisma.case.create({
      data: {
        id: caseId,
        orgId: ctx.orgId,
        userId: 'system',
        type: input.caseType,
        status: 'created',
        chatId: caseId,
      },
    })

    return { caseId, status: 'created' }
  },
}

registerBuiltin(dispatchCaseAgentTool)
