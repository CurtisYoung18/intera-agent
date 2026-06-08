// GET /api/admin/agent-templates/export — Export an Agent as .intera-agent.json.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiOk } from '@intera/shared/contracts/envelope'
import { defineRoute, NotFoundError, ValidationError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import {
  AgentTemplateNotFoundError,
  AgentTemplateValidationError,
  exportAgentTemplate,
} from '@/lib/agent-template'

const exportQuerySchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  templateName: z.string().optional(),
  download: z.string().optional(),
})

type ExportQuery = z.infer<typeof exportQuerySchema>

export const GET = defineRoute<ExportQuery>({
  method: 'GET',
  inputSchema: exportQuerySchema,
  parseQuery: true,
  async handler({ input, repo, audit }) {
    await assertAgentInOrg(repo, input.agentConfigId)

    try {
      const template = await exportAgentTemplate(repo, input.agentConfigId, {
        templateName: input.templateName,
      })
      const filename = `${template.metadata.templateId ?? 'intera-agent'}.intera-agent.json`

      await audit({
        action: 'agent_template.export',
        target: `agent_config:${input.agentConfigId}`,
        after: {
          filename,
          caseTypes: template.caseTypes.length,
          tools: template.tools.length,
          hooks: template.hooks.length,
          hookBindings: template.hookBindings.length,
          scenarios: template.scenarios.length,
        },
      })

      if (input.download === '1' || input.download === 'true') {
        return new NextResponse(JSON.stringify(template, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        })
      }

      return apiOk({ template, filename })
    } catch (err) {
      if (err instanceof AgentTemplateNotFoundError) throw new NotFoundError(err.message)
      if (err instanceof AgentTemplateValidationError) throw new ValidationError(err.message)
      throw err
    }
  },
})
