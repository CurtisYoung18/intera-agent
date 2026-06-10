// POST /api/admin/agent-templates/import — Import .intera-agent.json into a new draft Agent.

import { z } from 'zod'
import { apiCreated, apiOk } from '@intera/shared/contracts/envelope'
import { defineRoute, NotFoundError, ValidationError } from '@/lib/api/define-route'
import {
  AgentTemplateNotFoundError,
  AgentTemplateValidationError,
  importAgentTemplate,
} from '@/lib/agent-template'
import { isAgentVersioningError } from '@/lib/agent-config/versioning'

const importBodySchema = z.object({
  template: z.unknown(),
  name: z.string().optional(),
  parentAgentConfigId: z.string().optional(),
  dryRun: z.boolean().optional().default(false),
  strategy: z.enum(['createDraft']).optional(),
})

type ImportBody = z.infer<typeof importBodySchema>

export const POST = defineRoute<ImportBody>({
  method: 'POST',
  inputSchema: importBodySchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, repo, audit }) {
    try {
      const result = await importAgentTemplate(repo, input.template, {
        name: input.name,
        parentAgentConfigId: input.parentAgentConfigId,
        dryRun: input.dryRun,
        strategy: input.strategy,
      })

      if (result.dryRun) {
        return apiOk(result)
      }

      await audit({
        action: 'agent_template.import',
        target: `agent_config:${result.config.id}`,
        before: { parentAgentConfigId: input.parentAgentConfigId ?? null },
        after: {
          config: result.config,
          imported: result.imported,
          warnings: result.warnings,
        },
      })

      return apiCreated(result)
    } catch (err) {
      if (err instanceof AgentTemplateNotFoundError) throw new NotFoundError(err.message)
      if (err instanceof AgentTemplateValidationError) throw new ValidationError(err.message)
      if (isAgentVersioningError(err)) throw new ValidationError(err.message, err.fields)
      throw err
    }
  },
})
