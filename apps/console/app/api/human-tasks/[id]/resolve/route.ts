// POST /api/human-tasks/[id]/resolve — human submits verdict or manually closes

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { chatApiUrl } from '@/lib/chat-api'

// ── Helpers ──────────────────────────────────────────────────────────

async function notifyAgentResume(payload: {
  message: string
  caseId: string
  customerId: string
  userId: string
}): Promise<void> {
  const maxRetries = 3
  let delay = 500
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(chatApiUrl('/api/messages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return
    } catch (err) {
      console.error(`[Resolve] Notify agent attempt ${attempt}/${maxRetries} failed:`, err)
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delay))
        delay *= 2
      }
    }
  }
  console.error('[Resolve] Failed to notify agent after all retries')
}

// ── Route ────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json()
  const { verdict, expectedEta, notes, manualClose } = body

  // Update the human task
  await prisma.humanTask.update({
    where: { id },
    data: {
      status: 'resolved',
      verdict: verdict || 'manually_closed',
      expectedEta: expectedEta || null,
      notes: notes || null,
      resolvedAt: new Date(),
    },
  })

  const task = await prisma.humanTask.findUnique({
    where: { id },
    include: { case: true },
  })

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (manualClose) {
    // Manual close: resolve case entirely
    await prisma.case.update({
      where: { id: task.caseId },
      data: { status: 'resolved', blocker: null, resolvedAt: new Date() },
    })
    await prisma.actionTrace.create({
      data: {
        caseId: task.caseId,
        actionType: 'final_resolution',
        title: `Case manually closed: ${notes || 'No reason provided'}`,
        payload: JSON.stringify({ verdict, notes }),
      },
    })

    const message = [
      '[Case manually closed by operator]',
      `Reason: ${notes || 'Not specified'}`,
      'Please inform the customer and update the case card.',
    ].join('\n')

    await notifyAgentResume({
      message,
      caseId: task.caseId,
      customerId: task.case.customerId,
      userId: task.case.userId,
    })
  } else {
    // Normal resolve: unblock case so agent can resume
    await prisma.case.update({
      where: { id: task.caseId },
      data: { status: 'investigating', blocker: null },
    })
    await prisma.actionTrace.create({
      data: {
        caseId: task.caseId,
        actionType: 'human_task_resolved',
        title: `Human task resolved: ${verdict || 'completed'}`,
        payload: JSON.stringify({ verdict, expectedEta, notes }),
      },
    })

    const message = [
      '[Human task resolved — operator closed the case]',
      verdict ? `Operator verdict: ${verdict.replace(/_/g, ' ')}` : '',
      expectedEta ? `Expected resolution time: ${expectedEta}` : '',
      notes ? `Internal notes (do NOT share verbatim with customer): ${notes}` : '',
      'IMPORTANT — Customer communication task:\n1. Translate the operator\'s verdict and notes into plain, friendly language the customer can understand.\n2. Send this message to the customer NOW in your response — do not ask further questions.\n3. Format it as a helpful update, e.g.: "Hi! Our team has reviewed your case and [result]. Here\'s what this means for you: [explanation]."\n4. After sending the update, if the case is resolved, call finalize_case. Otherwise continue assisting.',
    ].filter(Boolean).join('\n')

    await notifyAgentResume({
      message,
      caseId: task.caseId,
      customerId: task.case.customerId,
      userId: task.case.userId,
    })
  }

  return NextResponse.json({ success: true })
}
