// Profiler utility — extracted from AgentLoop.

import type { Message } from '@intera/shared/types'
import { writeDebugTranscript } from './debug-logger'
import type { Profiler } from './profiler'
import type { TraceWriter } from './trace'
import type { AgentConfigData } from '@intera/shared/types'

export async function writeProfilerSnapshot(
  profiler: Profiler,
  traceWriter: TraceWriter,
  config: AgentConfigData,
  caseId: string,
  messages: Message[],
): Promise<void> {
  const snapshot = profiler.snapshot()
  if (snapshot.totalDurationMs > 0) {
    await traceWriter.write('loop_decision', 'Profiler Snapshot', snapshot as unknown as Record<string, unknown>)
  }
  if (config.debugMode) {
    writeDebugTranscript(caseId, messages)
  }
}
