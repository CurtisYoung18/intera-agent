import type { TranscriptHealthMetrics } from './provider-transcript'
import type { TraceWriter } from './trace'

export async function writeProviderTranscriptHealth(
  traceWriter: TraceWriter,
  metrics: TranscriptHealthMetrics,
): Promise<void> {
  await traceWriter.write('provider_transcript_health', 'Provider transcript invariant check', {
    providerTranscriptPersisted: false,
    providerTranscriptPresent: metrics.providerTranscriptPersisted,
    toolPairsChecked: metrics.toolPairsChecked,
    toolPairsRepaired: metrics.toolPairsRepaired,
    orphanToolResultsDropped: metrics.orphanToolResultsDropped,
    legacyRowsSkipped: metrics.legacyRowsSkipped,
    compactPairsSummarized: metrics.compactPairsSummarized,
  })

  for (const detail of metrics.details) {
    const title =
      detail.event === 'synthetic_repair' ? 'Provider transcript synthetic repair' :
      detail.event === 'orphan_drop' || detail.event === 'duplicate_drop' ? 'Provider transcript orphan result dropped' :
      detail.event === 'legacy_skip' ? 'Provider transcript legacy row skipped' :
      'Provider transcript compact pair summarized'
    const actionType =
      detail.event === 'synthetic_repair' ? 'provider_transcript_repair' :
      detail.event === 'orphan_drop' || detail.event === 'duplicate_drop' ? 'provider_transcript_orphan_drop' :
      detail.event === 'legacy_skip' ? 'provider_transcript_legacy_skip' :
      'provider_transcript_compact_summary'
    await traceWriter.write(actionType, title, detail as unknown as Record<string, unknown>)
  }
}
