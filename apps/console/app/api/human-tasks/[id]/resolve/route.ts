// POST /api/human-tasks/[id]/resolve — human submits verdict

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json()
  const { verdict, expectedEta, notes } = body

  // Update the human task
  await prisma.humanTask.update({
    where: { id },
    data: {
      status: 'resolved',
      verdict: verdict || null,
      expectedEta: expectedEta || null,
      notes: notes || null,
      resolvedAt: new Date(),
    },
  })

  // Get the task to find the case
  const task = await prisma.humanTask.findUnique({ where: { id } })
  if (task) {
    // Update case: remove blocker, set to investigating so agent can resume
    await prisma.case.update({
      where: { id: task.caseId },
      data: {
        status: 'investigating',
        blocker: null,
      },
    })

    // Write trace
    await prisma.actionTrace.create({
      data: {
        caseId: task.caseId,
        actionType: 'human_task_resolved',
        title: `Human task resolved: ${verdict || 'completed'}`,
        payload: JSON.stringify({ verdict, expectedEta, notes }),
      },
    })
  }

  // [MOCK] In production, this would trigger the Chat App's agent resume endpoint:
  //   await fetch('http://localhost:3000/api/messages', {
  //     method: 'POST',
  //     body: JSON.stringify({ resumeTrigger: task.caseId })
  //   })

  return NextResponse.json({ success: true })
}
