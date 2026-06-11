import {
  pilotInternalModelResolverResultSchema,
  type PilotInternalModelResolverRequest,
  type PilotInternalModelResolverResult,
} from '@intera/shared/contracts/pilot'
import { DEFAULT_MODEL } from '@intera/shared/defaults'

export function resolvePilotInternalModel(
  request: PilotInternalModelResolverRequest,
): PilotInternalModelResolverResult {
  const override = request.overrideModel?.trim()
  if (override) {
    return pilotInternalModelResolverResultSchema.parse({
      model: override,
      source: 'override',
      promptVersion: `pilot-${request.purpose}`,
    })
  }

  const agentConfigModel = request.agentConfigModel?.trim()
  if (agentConfigModel) {
    return pilotInternalModelResolverResultSchema.parse({
      model: agentConfigModel,
      source: 'agent_config',
      promptVersion: `pilot-${request.purpose}`,
    })
  }

  return pilotInternalModelResolverResultSchema.parse({
    model: DEFAULT_MODEL,
    source: 'system_default',
    promptVersion: `pilot-${request.purpose}`,
  })
}
