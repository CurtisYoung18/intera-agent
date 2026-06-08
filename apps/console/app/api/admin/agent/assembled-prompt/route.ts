// GET /api/admin/agent/assembled-prompt?agentId=...
// Returns the fully assembled system prompt with all injection blocks resolved.
// Used by the model page "Assembled Prompt" preview panel.
import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { buildModePrompt } from '@/lib/agent/buildModePrompt'
import { ToolRouter } from '@/lib/agent/tools'

const querySchema = z.object({ agentId: z.string().min(1, 'agentId is required') })

export const GET = defineRoute<z.infer<typeof querySchema>>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, repo }) {
    const { agentId } = input
    const config = await repo.agentConfig.findUnique({ where: { id: agentId } })
    if (!config) throw new NotFoundError('Config not found')

    const router = await ToolRouter.create(agentId)
    const tools = router.getToolDefinitions()
    const toolSummaries = tools.map((t) => ({
      name: t.name,
      description: t.description,
      needsMemberId: (t.inputSchema as any)?.properties?.member_id != null,
    }))

    const discoveryResult = await buildModePrompt({
      orgId: repo.orgId,
      coreSystemPrompt: config.coreSystemPrompt,
      hasActiveCase: false,
      caseSchema: null,
      caseState: null,
      availableTools: toolSummaries,
    })

    return apiOk({
      discovery: discoveryResult.prompt,
    })
  },
})
