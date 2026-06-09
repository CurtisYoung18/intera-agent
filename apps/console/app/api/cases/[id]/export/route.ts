// GET /api/cases/[id]/export — Export case as markdown
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { NextResponse } from 'next/server'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'

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

export const GET = defineRoute<void, { id: string }>({
  method: 'GET',
  async handler({ params, repo }) {
    const [caseData, messages, traces, humanTasks, memory] = await Promise.all([
      repo.case.findUnique({ where: { id: params.id } }),
      repo.raw.message.findMany({ where: { caseId: params.id }, orderBy: { createdAt: 'asc' } }),
      repo.raw.actionTrace.findMany({ where: { caseId: params.id }, orderBy: { createdAt: 'asc' } }),
      repo.raw.humanTask.findMany({ where: { caseId: params.id }, orderBy: { createdAt: 'asc' } }),
      repo.raw.chatMemory.findUnique({ where: { caseId: params.id } }),
    ])

    if (!caseData) throw new NotFoundError('Case not found')

    const agentConfig = await repo.agentConfig.findFirst({ where: { isActive: true } })

    const sections: string[] = []
    sections.push(`# Intera Case Export — ${params.id}`)
    sections.push(`Exported at: ${new Date().toISOString()}`)
    sections.push('')

    sections.push('## Case Metadata')
    sections.push(`- **ID**: ${caseData.id}`)
    sections.push(`- **Type**: ${caseData.type}`)
    sections.push(`- **Status**: ${caseData.status}`)
    sections.push(`- **User**: ${caseData.userId}`)
    sections.push(`- **Goal**: ${caseData.goal || '—'}`)
    sections.push(`- **Blocker**: ${caseData.blocker || '—'}`)
    sections.push(`- **Created**: ${caseData.createdAt.toISOString()}`)
    sections.push(`- **Updated**: ${caseData.updatedAt.toISOString()}`)
    if (caseData.resolvedAt) sections.push(`- **Resolved**: ${(caseData.resolvedAt as Date).toISOString()}`)
    sections.push('')

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

    sections.push('## Action Traces')
    sections.push(`Total traces: ${traces.length}`)
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
      sections.push('## Case Memory')
      sections.push('### Confirmed Facts')
      sections.push(formatValue(safeJson(memory.confirmedFacts)))
      sections.push('')
      sections.push('### Missing Facts')
      sections.push(formatValue(safeJson(memory.missingFacts)))
      sections.push('')
      sections.push('### Skills Called')
      sections.push(formatValue(safeJson(memory.toolsCalled)))
      sections.push('')
      sections.push('### Skill Results')
      sections.push(formatValue(safeJson(memory.toolResults)))
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
        'Content-Disposition': `attachment; filename="case-${params.id.slice(0, 8)}-export.md"`,
      },
    })
  },
})
