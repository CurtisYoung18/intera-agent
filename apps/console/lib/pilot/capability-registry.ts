import {
  pilotCapabilityManifestSchema,
  type PilotCapabilityManifest,
} from '@intera/shared/contracts/pilot'

const PILOT_CAPABILITIES: PilotCapabilityManifest[] = [
  {
    capabilityKey: 'config.context.read',
    surface: 'config',
    mode: 'read',
    llmVisible: 'metadata_only',
    requiresDraft: true,
    requiresExplicitAccept: false,
    callableByPilot: true,
    toolFamily: 'inspect_config_surface',
  },
  {
    capabilityKey: 'scenario.receipts.inspect',
    surface: 'scenarios',
    mode: 'read',
    llmVisible: 'redacted',
    requiresDraft: true,
    requiresExplicitAccept: false,
    callableByPilot: true,
    toolFamily: 'inspect_validation_artifact',
  },
  {
    capabilityKey: 'config.proposal.draft',
    surface: 'config',
    mode: 'write',
    llmVisible: 'metadata_only',
    requiresDraft: true,
    requiresExplicitAccept: true,
    callableByPilot: true,
    toolFamily: 'draft_batch_proposal',
  },
  {
    capabilityKey: 'scenario.run_named',
    surface: 'scenarios',
    mode: 'test',
    llmVisible: 'redacted',
    requiresDraft: true,
    requiresExplicitAccept: false,
    callableByPilot: true,
    toolFamily: 'run_named_scenario',
  },
  {
    capabilityKey: 'pilot.handoff.generate',
    surface: 'pilot',
    mode: 'test',
    llmVisible: 'metadata_only',
    requiresDraft: true,
    requiresExplicitAccept: false,
    callableByPilot: true,
    toolFamily: 'generate_release_handoff',
  },
].map((capability) => pilotCapabilityManifestSchema.parse(capability))

export function listPilotCapabilities(): PilotCapabilityManifest[] {
  return PILOT_CAPABILITIES
}

export function listPilotExplorationCapabilities(): PilotCapabilityManifest[] {
  return PILOT_CAPABILITIES.filter((capability) => (
    capability.callableByPilot
    && capability.mode !== 'write'
    && !capability.requiresExplicitAccept
  ))
}
