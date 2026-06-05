import { DEFAULT_MODEL } from '@intera/shared/defaults'

/**
 * Resolve the effective model from an agent config.
 * Falls back to DEFAULT_MODEL when config.model is empty/absent,
 * so the UI never shows "Unknown" and the runner always has a valid model.
 */
export function resolveEffectiveModel(config: { model?: string | null }): string {
  return config.model || DEFAULT_MODEL
}
