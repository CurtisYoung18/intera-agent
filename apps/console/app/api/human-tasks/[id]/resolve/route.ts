// POST /api/human-tasks/[id]/resolve — human submits verdict or manually closes

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

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

    // Notify agent so it can update the customer
    try {
      await fetch('http://localhost:3000/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[Case manually closed by operator]\nReason: ${notes || 'Not specified'}\nPlease inform the customer and update the case card.`,
          caseId: task.caseId,
          customerId: task.case.customerId,
          userId: task.case.userId,
        }),
      })
    } catch (err) {
      console.error('[Resolve] Failed to notify agent:', err)
    }
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

    // Notify agent to resume
    try {
      await fetch('http://localhost:3000/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[Human task resolved]\nVerdict: ${verdict}\nNotes: ${notes || 'N/A'}\nPlease continue processing this case.`,
          caseId: task.caseId,
          customerId: task.case.customerId,
          userId: task.case.userId,
        }),
      })
    } catch (err) {
      console.error('[Resolve] Failed to notify agent:', err)
    }
  }

  return NextResponse.json({ success: true })
}
