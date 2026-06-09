// Tools domain contract — request/response zod schemas for /api/admin/tools

import { z } from 'zod'
import { stableNameSchema } from './hooks'

export const TOOL_MODES = [
  'static_fixture',
  'http',
  'system_managed',
  'channel',
  'workflow',
  'code_transform',
] as const
export const toolModeSchema = z.enum(TOOL_MODES)
export type ToolMode = z.infer<typeof toolModeSchema>

// Historical runtime values accepted only as import/route compatibility input.
// Export/import contracts write TOOL_MODES only.
export const LEGACY_TOOL_MODES = ['mock', 'static', 'engine_managed'] as const
export const legacyToolModeSchema = z.enum(LEGACY_TOOL_MODES)

export function normalizeToolMode(mode: string | null | undefined): ToolMode {
  switch (mode) {
    case 'mock':
    case 'static':
    case 'static_fixture':
      return 'static_fixture'
    case 'engine_managed':
    case 'system_managed':
      return 'system_managed'
    case 'channel':
      return 'channel'
    case 'workflow':
      return 'workflow'
    case 'code_transform':
      return 'code_transform'
    case 'http':
    default:
      return 'http'
  }
}

// ── Tool item (returned in list + single responses) ──
export const toolItemSchema = z.object({
  id: z.string(),
  name: stableNameSchema,
  description: z.string(),
  mode: z.string(),
  endpoint: z.string().nullable().optional(),
  httpMethod: z.string().nullable().optional(),
  timeoutMs: z.number().nullable().optional(),
  inputSchema: z.string().nullable().optional(),
  outputSchema: z.string().nullable().optional(),
  headers: z.string().nullable().optional(),
  staticFixture: z.string().nullable().optional(),
  mockFixture: z.string().nullable().optional(),
  renderHints: z.string().nullable().optional(),
  guardPhase: z.string().nullable().optional(),
  toolCategory: z.string().nullable().optional(),
  displayVerb: z.string().nullable().optional(),
  isConcurrencySafe: z.boolean(),
  enabled: z.boolean(),
  isSystem: z.boolean().optional(),
  isChannel: z.boolean().optional(),
  isSpecial: z.boolean().optional(),
})

export type ToolItem = z.infer<typeof toolItemSchema>

// ── GET /api/admin/tools response ──
export const toolsListResponseSchema = z.object({
  tools: z.array(toolItemSchema),
})
export type ToolsListResponse = z.infer<typeof toolsListResponseSchema>

// ── POST /api/admin/tools request body ──
export const toolCreateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  inputSchema: z.union([z.string(), z.record(z.unknown())]).optional().default('{}'),
  outputSchema: z.union([z.string(), z.record(z.unknown())]).optional().default('{}'),
  mode: z.string().optional().default('static_fixture'),
  endpoint: z.string().nullable().optional(),
  httpMethod: z.string().optional().default('POST'),
  headers: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  timeoutMs: z.number().optional().default(8000),
  staticFixture: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  mockFixture: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  guardPhase: z.string().optional().default('post'),
  displayVerb: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  renderHints: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  isConcurrencySafe: z.boolean().optional().default(true),
  enabled: z.boolean().optional().default(true),
  toolCategory: z.string().nullable().optional(),
})
export type ToolCreateRequest = z.infer<typeof toolCreateRequestSchema>

// ── POST /api/admin/tools response ──
export const toolCreateResponseSchema = z.object({
  tool: toolItemSchema,
})
export type ToolCreateResponse = z.infer<typeof toolCreateResponseSchema>

// ── GET /api/admin/tools/[name] response ──
export const toolGetResponseSchema = z.object({
  tool: toolItemSchema,
})
export type ToolGetResponse = z.infer<typeof toolGetResponseSchema>

// ── PUT /api/admin/tools/[name] request body ──
export const toolUpdateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().optional(),
  inputSchema: z.union([z.string(), z.record(z.unknown())]).optional(),
  outputSchema: z.union([z.string(), z.record(z.unknown())]).optional(),
  mode: z.string().optional(),
  endpoint: z.string().nullable().optional(),
  httpMethod: z.string().optional(),
  headers: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  timeoutMs: z.number().optional(),
  staticFixture: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  mockFixture: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  guardPhase: z.string().optional(),
  displayVerb: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  renderHints: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  isConcurrencySafe: z.boolean().optional(),
  enabled: z.boolean().optional(),
  toolCategory: z.string().nullable().optional(),
})
export type ToolUpdateRequest = z.infer<typeof toolUpdateRequestSchema>

// ── PUT /api/admin/tools/[name] response ──
export const toolUpdateResponseSchema = z.object({
  tool: toolItemSchema,
})
export type ToolUpdateResponse = z.infer<typeof toolUpdateResponseSchema>

// ── .intera-agent.json Tool section ──
export const templateToolSchema = z.object({
  name: stableNameSchema,
  displayName: z.string().optional(),
  description: z.string(),
  mode: toolModeSchema,
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  endpoint: z.string().optional(),
  httpMethod: z.enum(['GET', 'POST']).default('POST'),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().default(8000),
  staticFixture: z.unknown().optional(),
  displayVerb: z.object({
    text: z.string(),
    icon: z.enum(['dots', 'pulse', 'spin', 'scan']),
  }).optional(),
  renderHints: z.record(z.unknown()).optional(),
  toolCategory: z.enum(['system_info', 'operational']).nullable().optional(),
  isConcurrencySafe: z.boolean().default(true),
  enabled: z.boolean().default(true),
  legacy: z.record(z.unknown()).optional(),
})
export type TemplateTool = z.infer<typeof templateToolSchema>
