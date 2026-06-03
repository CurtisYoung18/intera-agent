// Streaming text sanitizer — strips <think> blocks and Tool-result leakage
// from the model's output as it streams. Used by AgentLoop for each iteration.

export class StreamingTextSanitizer {
  private static readonly HOLD_BACK = 60
  private buf = ''
  private inThink = false
  private inToolResult = false

  feed(chunk: string): string {
    this.buf += chunk
    return this.drain()
  }

  flush(): string {
    if (this.inThink || this.inToolResult) {
      this.buf = ''
      return ''
    }
    const out = this.buf
    this.buf = ''
    return out
  }

  private drain(): string {
    let out = ''
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.inThink) {
        const end = this.buf.indexOf('</think>')
        if (end === -1) break
        this.buf = this.buf.slice(end + 8).replace(/^\s+/, '')
        this.inThink = false
        continue
      }
      if (this.inToolResult) {
        const blank = this.buf.indexOf('\n\n')
        if (blank === -1) break
        this.buf = this.buf.slice(blank + 2)
        this.inToolResult = false
        continue
      }

      let earliest = -1
      let kind: 'think' | 'orphan' | 'tool' | null = null
      const tryIdx = (idx: number, k: typeof kind) => {
        if (idx !== -1 && (earliest === -1 || idx < earliest)) {
          earliest = idx
          kind = k
        }
      }
      tryIdx(this.buf.indexOf('<think>'), 'think')
      tryIdx(this.buf.indexOf('</think>'), 'orphan')
      const toolM = this.buf.match(/Tool \w+ result: /)
      tryIdx(toolM ? this.buf.indexOf(toolM[0]) : -1, 'tool')

      if (earliest === -1) {
        const safe = Math.max(0, this.buf.length - StreamingTextSanitizer.HOLD_BACK)
        out += this.buf.slice(0, safe)
        this.buf = this.buf.slice(safe)
        break
      }

      if (kind === 'think') {
        out += this.buf.slice(0, earliest)
        this.buf = this.buf.slice(earliest + '<think>'.length)
        this.inThink = true
      } else if (kind === 'orphan') {
        out += this.buf.slice(0, earliest)
        this.buf = this.buf.slice(earliest + '</think>'.length).replace(/^\s+/, '')
      } else if (kind === 'tool') {
        out += this.buf.slice(0, earliest)
        this.buf = this.buf.slice(earliest + toolM![0].length)
        this.inToolResult = true
      }
    }
    return out
  }
}
