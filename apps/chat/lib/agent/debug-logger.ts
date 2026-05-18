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
): void {
  try {
    const dir = path.join(DEBUG_DIR, caseId)
    ensureDir(dir)
    const file = path.join(dir, `${String(iteration).padStart(3, '0')}-req.json`)
    fs.writeFileSync(file, safeStringify({
      timestamp: new Date().toISOString(),
      model,
      iteration,
      ...payload,
    }), 'utf-8')
  } catch (err) {
    console.warn('[DebugLogger] Failed to write request log:', err)
  }
}

export function writeDebugResponse(
  caseId: string,
  iteration: number,
  model: string,
  payload: Record<string, unknown>,
): void {
  try {
    const dir = path.join(DEBUG_DIR, caseId)
    ensureDir(dir)
    const file = path.join(dir, `${String(iteration).padStart(3, '0')}-resp.json`)
    fs.writeFileSync(file, safeStringify({
      timestamp: new Date().toISOString(),
      model,
      iteration,
      ...payload,
    }), 'utf-8')
  } catch (err) {
    console.warn('[DebugLogger] Failed to write response log:', err)
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
    const file = path.join(dir, `${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
    fs.writeFileSync(file, safeStringify({
      timestamp: new Date().toISOString(),
      model,
      label,
      ...payload,
    }), 'utf-8')
  } catch (err) {
    console.warn('[DebugLogger] Failed to write standalone call log:', err)
  }
}
