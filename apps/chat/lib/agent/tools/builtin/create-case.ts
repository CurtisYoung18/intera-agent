import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

const inputSchema = z.object({
  caseType: z.string().describe('Case type slug (e.g. deposit_issue, account_issue)'),
})

type Input = z.infer<typeof inputSchema>
type Output = { caseId: string; status: 'created' }

export const createCaseTool: Tool<Input, Output> = {
  name: 'create_case',
  source: 'builtin',
  inputSchema,
  guardPhase: 'post',
  displayVerb: { text: 'Creating your case', icon: 'dots' },

  async prompt(_ctx: ToolContext) {
    return 'Create a tracked Case for a single clear customer issue. ' +
      'Use when the customer reports one distinct problem. ' +
      'For multiple issues or ambiguous intent, use propose_cases instead.'
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
        vendorId: ctx.vendorId,
        userId: 'system',
        type: input.caseType,
        status: 'created',
      },
    })

    return { caseId, status: 'created' }
  },
}

registerBuiltin(createCaseTool)
