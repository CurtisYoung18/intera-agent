// Knowledge Sources domain contract — request/response zod schemas for /api/admin/knowledge/sources

import { z } from 'zod'

// ── Knowledge source item ──
export const knowledgeSourceItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  groupIds: z.string(),
  dataIds: z.string().nullable().optional(),
  embeddingRate: z.number(),
  topK: z.number(),
  rerankVersion: z.string().nullable().optional(),
  docCorrelation: z.number().nullable().optional(),
  caseTypeTag: z.string().nullable().optional(),
  enabled: z.boolean(),
  createdAt: z.date().or(z.string()).optional(),
  updatedAt: z.date().or(z.string()).optional(),
})

export type KnowledgeSourceItem = z.infer<typeof knowledgeSourceItemSchema>

// ── GET /api/admin/knowledge/sources response ──
export const knowledgeSourcesListResponseSchema = z.object({
  sources: z.array(knowledgeSourceItemSchema),
})
export type KnowledgeSourcesListResponse = z.infer<typeof knowledgeSourcesListResponseSchema>

// ── POST /api/admin/knowledge/sources request body ──
export const knowledgeSourceCreateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
  groupIds: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  dataIds: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  embeddingRate: z.number().optional().default(0.9),
  topK: z.number().optional().default(15),
  rerankVersion: z.string().nullable().optional(),
  docCorrelation: z.number().optional().default(0.3),
  caseTypeTag: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(true),
})
export type KnowledgeSourceCreateRequest = z.infer<typeof knowledgeSourceCreateRequestSchema>

// ── POST /api/admin/knowledge/sources response ──
export const knowledgeSourceCreateResponseSchema = z.object({
  source: knowledgeSourceItemSchema,
})
export type KnowledgeSourceCreateResponse = z.infer<typeof knowledgeSourceCreateResponseSchema>

// ── GET /api/admin/knowledge/sources/[id] response ──
export const knowledgeSourceGetResponseSchema = z.object({
  source: knowledgeSourceItemSchema,
})
export type KnowledgeSourceGetResponse = z.infer<typeof knowledgeSourceGetResponseSchema>

// ── PUT /api/admin/knowledge/sources/[id] request body ──
export const knowledgeSourceUpdateRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  groupIds: z.union([z.string(), z.array(z.string())]).optional(),
  dataIds: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  embeddingRate: z.number().optional(),
  topK: z.number().optional(),
  rerankVersion: z.string().nullable().optional(),
  docCorrelation: z.number().nullable().optional(),
  caseTypeTag: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
})
export type KnowledgeSourceUpdateRequest = z.infer<typeof knowledgeSourceUpdateRequestSchema>

// ── PUT /api/admin/knowledge/sources/[id] response ──
export const knowledgeSourceUpdateResponseSchema = z.object({
  source: knowledgeSourceItemSchema,
})
export type KnowledgeSourceUpdateResponse = z.infer<typeof knowledgeSourceUpdateResponseSchema>
