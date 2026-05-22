// Debug Logger — writes full API request/response payloads to disk for troubleshooting.
// Only active when AgentConfig.debugMode === true. Files go to debug-logs/<caseId>/.

import * as fs from 'fs'
import * as path from 'path'

const DEBUG_DIR = 'debug-logs'

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

/**
 * Returns the next available sequence number for a case directory.
 * Scans existing *-req.json files to avoid collisions across sessions
 * that reset the iteration counter.
 */
function nextSeq(caseDir: string): number {
  try {
    const files = fs.readdirSync(caseDir)
    let max = 0
    for (const f of files) {
      const m = f.match(/^(\d+)-/)
      if (m) {
        max = Math.max(max, parseInt(m[1], 10))
      }
    }
    return max + 1
  } catch {
    return 1
  }
}

export interface DebugLogEntry {
  timestamp: string
  model: string
  iteration: number
}

export function writeDebugRequest(
  caseId: string,
  iteration: number,
  model: string,
  payload: {
    system?: string
    messages?: unknown[]
    tools?: unknown[]
    max_tokens?: number
    temperature?: number
  },
): number {
  try {
    const dir = path.join(DEBUG_DIR, caseId)
    ensureDir(dir)
    const seq = nextSeq(dir)
    const file = path.join(dir, `${String(seq).padStart(3, '0')}-req.json`)
    fs.writeFileSync(file, safeStringify({
      timestamp: new Date().toISOString(),
      model,
      iteration,
      seq,
      ...payload,
    }), 'utf-8')
    return seq
  } catch (err) {
    console.warn('[DebugLogger] Failed to write request log:', err)
    return -1
  }
}

export function writeDebugResponse(
  caseId: string,
  iteration: number,
  model: string,
  seq: number,
  payload: Record<string, unknown>,
): void {
  if (seq < 0) return
  try {
    const dir = path.join(DEBUG_DIR, caseId)
    ensureDir(dir)
    const file = path.join(dir, `${String(seq).padStart(3, '0')}-resp.json`)
    fs.writeFileSync(file, safeStringify({
      timestamp: new Date().toISOString(),
      model,
      iteration,
      seq,
      ...payload,
    }), 'utf-8')
  } catch (err) {
    console.warn('[DebugLogger] Failed to write response log:', err)
  }
}

/**
 * Write a human-readable markdown transcript of the full conversation.
 * Overwrites transcript.md in the case debug directory each turn.
 */
export function writeDebugTranscript(
  caseId: string,
  messages: Array<{ role: string; content: string }>,
): void {
  try {
    const dir = path.join(DEBUG_DIR, caseId)
    ensureDir(dir)
    const file = path.join(dir, 'transcript.md')

    const lines: string[] = []
    lines.push(`Total messages: ${messages.length}`)

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      lines.push(`[${i}] ${msg.role}: ${content}`)
    }

    fs.writeFileSync(file, lines.join('\n'), 'utf-8')
  } catch (err) {
    console.warn('[DebugLogger] Failed to write transcript:', err)
  }
}

/** Write a standalone LLM call (stage eval, fact extraction, policy eval, intent classify). */
export function writeDebugStandaloneCall(
  caseId: string,
  label: string,
  model: string,
  payload: {
    system?: string
    messages?: unknown[]
    tools?: unknown[]
    response?: unknown
    usage?: unknown
  },
): void {
  try {
    const dir = path.join(DEBUG_DIR, caseId)
    ensureDir(dir)
    const seq = nextSeq(dir)
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_')
    const file = path.join(dir, `${String(seq).padStart(3, '0')}-${safeLabel}.json`)
    fs.writeFileSync(file, safeStringify({
      timestamp: new Date().toISOString(),
      model,
      label,
      seq,
      ...payload,
    }), 'utf-8')
  } catch (err) {
    console.warn('[DebugLogger] Failed to write standalone call log:', err)
  }
}
