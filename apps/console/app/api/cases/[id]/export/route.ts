import { prisma } from '@intera/shared/prisma'
import { NextResponse } from 'next/server'

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const [caseData, messages, traces, humanTasks, memory] = await Promise.all([
    prisma.case.findUnique({ where: { id } }),
    prisma.message.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } }),
    prisma.actionTrace.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } }),
    prisma.humanTask.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } }),
    prisma.caseMemory.findUnique({ where: { caseId: id } }),
  ])

  if (!caseData) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const agentConfig = await prisma.agentConfig.findUnique({
    where: { customerId: caseData.customerId },
  })

  const sections: string[] = []

  // ── Header ──
  sections.push(`# Intera Case Export — ${id}`)
  sections.push(`Exported at: ${new Date().toISOString()}`)
  sections.push('')

  // ── Case Metadata ──
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

  // ── Agent Config ──
  if (agentConfig) {
    sections.push('## Agent Config')
    sections.push(`- **Model**: ${agentConfig.model}`)
    sections.push(`- **Evaluation Model**: ${(agentConfig as any).evaluationModel || 'default'}`)
    sections.push(`- **Temperature**: ${agentConfig.temperature}`)
    sections.push(`- **Thinking Budget**: ${agentConfig.thinkingBudget}`)
    sections.push(`- **Max Iterations**: ${agentConfig.maxIterations}`)
    sections.push(`- **Show Thinking**: ${agentConfig.showThinking}`)
    sections.push('')
  }

  // ── Conversation ──
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

  // ── Action Traces ──
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
        if (typeof v === 'object') {
          sections.push(`- **${k}**: ${JSON.stringify(v)}`)
        } else {
          sections.push(`- **${k}**: ${v}`)
        }
      }
    }
    sections.push('')
  }

  // ── Case Memory ──
  if (memory) {
    sections.push('## Case Memory')
    const facts = safeJson(memory.confirmedFacts)
    const missing = safeJson(memory.missingFacts)
    const skills = safeJson(memory.skillsCalled)
    const results = safeJson(memory.skillResults)

    sections.push('### Confirmed Facts')
    sections.push(formatValue(facts))
    sections.push('')
    sections.push('### Missing Facts')
    sections.push(formatValue(missing))
    sections.push('')
    sections.push('### Skills Called')
    sections.push(formatValue(skills))
    sections.push('')
    sections.push('### Skill Results')
    sections.push(formatValue(results))
    sections.push('')
    if (memory.summary) {
      sections.push('### Summary')
      sections.push(memory.summary)
      sections.push('')
    }
  }

  // ── Human Tasks ──
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
      'Content-Disposition': `attachment; filename="case-${id.slice(0, 8)}-export.md"`,
    },
  })
}
