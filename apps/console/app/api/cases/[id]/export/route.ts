// GET /api/cases/[id]/export — Export case as markdown
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { NextResponse } from 'next/server'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { stripInternalMemoryKeys } from '@/lib/agent/memory'
import { getRuntimeSourceTruth } from '@/lib/operate/runtime-truth'
import { assertCaseInAgentScope, requireSelectedAgentFromInput } from '@/app/api/_agent-scope'
import { z } from 'zod'

function safeJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return raw }
}

function formatValue(v: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${pad}- **${k}**: ${typeof val === 'object' ? '\n' + formatValue(val, indent + 1) : String(val)}`)
      .join('\n')
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    return v.map((item) => `${pad}- ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`).join('\n')
  }
  return String(v)
}

function stripInternalKeysFromValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripInternalKeysFromValue(item))
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(stripInternalMemoryKeys(value as Record<string, unknown>))
      .map(([key, item]) => [key, stripInternalKeysFromValue(item)]),
  )
}

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { id: string }>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const agentConfigId = requireSelectedAgentFromInput(input)
    const scopedRun = await assertCaseInAgentScope(repo, params.id, agentConfigId)
    const caseData = await repo.case.findUnique({ where: { id: params.id } })
    if (!caseData) throw new NotFoundError('ProcedureRun not found')

    const [messages, traces, humanTasks, memory] = await Promise.all([
      repo.raw.message.findMany({ where: { orgId: repo.orgId, caseId: params.id }, orderBy: { createdAt: 'asc' } }),
      repo.raw.actionTrace.findMany({ where: { orgId: repo.orgId, caseId: params.id }, orderBy: { createdAt: 'asc' } }),
      repo.raw.humanTask.findMany({ where: { orgId: repo.orgId, caseId: params.id }, orderBy: { createdAt: 'asc' } }),
      repo.raw.chatMemory.findFirst({ where: { orgId: repo.orgId, caseId: params.id } }),
    ])

    const agentConfig = await repo.agentConfig.findUnique({ where: { id: agentConfigId } })

    const sections: string[] = []
    const displayRunId = scopedRun.runId
    sections.push(`# Intera ProcedureRun Export — ${displayRunId}`)
    sections.push(`Exported at: ${new Date().toISOString()}`)
    sections.push('')

    sections.push('## ProcedureRun Metadata')
    sections.push(`- **Run ID**: ${displayRunId}`)
    sections.push(`- **Type**: ${caseData.type}`)
    sections.push(`- **Status**: ${caseData.status}`)
    sections.push(`- **Source**: ${caseData.source ?? 'live'}`)
    sections.push(`- **User**: ${caseData.userId}`)
    sections.push(`- **Goal**: ${caseData.goal || '—'}`)
    sections.push(`- **Blocker**: ${caseData.blocker || '—'}`)
    sections.push(`- **Created**: ${caseData.createdAt.toISOString()}`)
    sections.push(`- **Updated**: ${caseData.updatedAt.toISOString()}`)
    if (caseData.resolvedAt) sections.push(`- **Resolved**: ${(caseData.resolvedAt as Date).toISOString()}`)
    sections.push('')

    const sourceTruth = getRuntimeSourceTruth({ source: caseData.source ?? 'live', userId: caseData.userId })
    if (sourceTruth.isSynthetic) {
      sections.push('## Runtime Truth Note')
      sections.push('- This ProcedureRun is a synthetic review export from Playground.')
      sections.push('- It is review-only and does not represent a live customer chat or live external side effects.')
      sections.push('- Timeline rows below may be exported stage summaries instead of raw runtime events.')
      sections.push('')
    }

    if (agentConfig) {
      sections.push('## Agent Config')
      sections.push(`- **Model**: ${agentConfig.model}`)
      sections.push(`- **Temperature**: ${agentConfig.temperature}`)
      sections.push(`- **Thinking Budget**: ${agentConfig.thinkingBudget}`)
      sections.push(`- **Max Iterations**: ${agentConfig.maxIterations}`)
      sections.push(`- **Extended Thinking**: ${agentConfig.extendedThinking}`)
      sections.push('')
    }

    sections.push('## Conversation')
    sections.push(`Total messages: ${messages.length}`)
    sections.push('')
    for (const msg of messages) {
      const roleLabel = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : msg.role
      const time = new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour12: false })
      sections.push(`### ${roleLabel} · ${time}`)
      sections.push(msg.content || '(empty)')
      sections.push('')
    }

    sections.push('## Timeline & Evidence')
    sections.push(`Total timeline events: ${traces.length}`)
    sections.push('')
    for (const trace of traces) {
      const time = new Date(trace.createdAt).toLocaleTimeString('zh-CN', { hour12: false })
      const payload = safeJson(trace.payload as string)
      sections.push(`### ${trace.actionType} — ${trace.title}`)
      sections.push(`**Time**: ${time}`)
      if (trace.detail) sections.push(`**Detail**: ${trace.detail}`)
      if (payload && typeof payload === 'object') {
        sections.push('**Payload**:')
        for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
          sections.push(`- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        }
      }
      sections.push('')
    }

    if (memory) {
      sections.push('## Memory')
      sections.push('### Missing Facts')
      sections.push(formatValue(safeJson(memory.missingFacts)))
      sections.push('')
      sections.push('### Key Events')
      sections.push(formatValue(stripInternalKeysFromValue(safeJson(memory.keyEvents))))
      sections.push('')
      sections.push('### Tools Called')
      sections.push(formatValue(safeJson(memory.toolsCalled)))
      sections.push('')
      sections.push('### Tool Results')
      sections.push(formatValue(stripInternalKeysFromValue(safeJson(memory.toolResults))))
      sections.push('')
      if (memory.summary) {
        sections.push('### Summary')
        sections.push(memory.summary)
        sections.push('')
      }
    }

    if (humanTasks.length > 0) {
      sections.push('## Human Tasks')
      for (const ht of humanTasks) {
        sections.push(`- **ID**: ${ht.id}`)
        sections.push(`  - Queue: ${ht.queue}`)
        sections.push(`  - Status: ${ht.status}`)
        sections.push(`  - Question: ${ht.question}`)
        if (ht.verdict) sections.push(`  - Verdict: ${ht.verdict}`)
        if (ht.notes) sections.push(`  - Notes: ${ht.notes}`)
        sections.push('')
      }
    }

    const markdown = sections.join('\n')
    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="run-${displayRunId.slice(0, 8)}-export.md"`,
      },
    })
  },
})
