import { DEFAULT_MODEL } from '@intera/shared/defaults'

export function selectConfigPilotModel(
  selectedAgentModel: string | null | undefined,
  env?: { CONFIG_PILOT_MODEL?: string },
): string {
  return env?.CONFIG_PILOT_MODEL?.trim() || process.env.CONFIG_PILOT_MODEL?.trim() || selectedAgentModel || DEFAULT_MODEL
}
