// S4 — Tool Interface Unification
// Core Tool<I,O> interface mirroring Claude Code's Tool.ts pattern.
// Built-in tools implement this directly; business tools go through an adapter.

import { z, type ZodType } from 'zod'
import type { SpinnerIcon } from '../types'

// ── Channels ──────────────────────────────────────────────────

export type Channel = 'web-chat' | 'livechat' | 'slack' | 'discord' | 'whatsapp'

export interface RenderHint {
  kind: 'card' | 'form' | 'plain' | 'list' | 'image'
  template?: string
  transform?: string
}

// ── Context ───────────────────────────────────────────────────

export interface ChatMemoryReader {
  caseId: string
  getSummary(): unknown
  getConfirmedFacts(): Record<string, unknown>
  setConfirmedFactsBulk(facts: Record<string, unknown>): void
  getDashboardVersion(): number
  bumpDashboardVersion(): void
  getTodos?(): unknown[]
  applyTodoAction?(action: string, id?: string, text?: string, notes?: string): unknown
}

export interface OrchestratorRef {
  dispatch(name: string, task: { description: string; taskPrompt: string; caseId: string }): Promise<unknown>
}

export interface SecretResolver {
  resolve(value: string): string
}

export interface ToolContext {
  caseId: string
  orgId: string
  signal: AbortSignal
  chatMemory?: ChatMemoryReader
  orchestrator?: OrchestratorRef
  secrets?: SecretResolver
}

// ── Validation ────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; parsed: unknown }
  | { ok: false; error: string }

// ── Tool ──────────────────────────────────────────────────────

export interface Tool<I = unknown, O = unknown> {
  readonly name: string
  readonly source: 'builtin' | 'business'

  prompt(ctx: ToolContext): Promise<string>
  readonly inputSchema: ZodType<I>

  isEnabled(): boolean
  isConcurrencySafe(input?: I): boolean
  isReadOnly(input?: I): boolean
  validateInput?(input: I, ctx: ToolContext): Promise<ValidationResult>

  readonly guardPhase: 'pre' | 'post' | null

  call(input: I, ctx: ToolContext): Promise<O>

  readonly displayVerb: { text: string; icon: SpinnerIcon }
  readonly renderHints?: Partial<Record<Channel, RenderHint>>
}

// ── Helpers ───────────────────────────────────────────────────

const BUILTIN_TOOLS = new Map<string, Tool>()

export function registerBuiltin(tool: Tool): void {
  BUILTIN_TOOLS.set(tool.name, tool)
}

export function getBuiltin(name: string): Tool | undefined {
  return BUILTIN_TOOLS.get(name)
}

export function getAllBuiltins(): Tool[] {
  return [...BUILTIN_TOOLS.values()]
}

export function isBuiltin(name: string): boolean {
  return BUILTIN_TOOLS.has(name)
}
