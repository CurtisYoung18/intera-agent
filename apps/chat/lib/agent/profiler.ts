// Intera Harness — Query Profiler
// Records key performance metrics per agent turn and writes a snapshot
// to ActionTrace for observability in Console /ops/cases/[id] traces.

export interface ProfilerSnapshot {
  ttftMs: number           // Time to first token
  totalDurationMs: number  // Total turn duration
  toolExecutionMs: number  // Total tool execution time
  compactionCount: number  // Number of compaction events
  inputTokens?: number     // Total input tokens used
  outputTokens?: number    // Total output tokens generated
  iterationCount: number   // Number of LLM iterations in this turn
}

export class Profiler {
  private turnStart: number = 0
  private firstTokenAt: number | null = null
  private toolExecutionMs: number = 0
  private compactionCount: number = 0
  private inputTokens: number = 0
  private outputTokens: number = 0
  private iterationCount: number = 0

  startTurn(): void {
    this.turnStart = Date.now()
    this.firstTokenAt = null
    this.toolExecutionMs = 0
    this.compactionCount = 0
    this.inputTokens = 0
    this.outputTokens = 0
    this.iterationCount = 0
  }

  recordFirstToken(): void {
    if (!this.firstTokenAt) {
      this.firstTokenAt = Date.now()
    }
  }

  addToolExecution(ms: number): void {
    this.toolExecutionMs += ms
  }

  incrementCompaction(): void {
    this.compactionCount++
  }

  incrementIteration(): void {
    this.iterationCount++
  }

  addTokens(input: number, output: number): void {
    this.inputTokens += input
    this.outputTokens += output
  }

  snapshot(): ProfilerSnapshot {
    return {
      ttftMs: this.firstTokenAt ? this.firstTokenAt - this.turnStart : 0,
      totalDurationMs: Date.now() - this.turnStart,
      toolExecutionMs: this.toolExecutionMs,
      compactionCount: this.compactionCount,
      inputTokens: this.inputTokens > 0 ? this.inputTokens : undefined,
      outputTokens: this.outputTokens > 0 ? this.outputTokens : undefined,
      iterationCount: this.iterationCount,
    }
  }
}
