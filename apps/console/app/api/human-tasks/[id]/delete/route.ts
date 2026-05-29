// DELETE /api/human-tasks/[id]/delete — Debug: delete a case and all related data

import { NextRequest } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const task = await prisma.humanTask.findUnique({ where: { id } })
    if (!task) {
      return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })
    }

    const caseId = task.caseId

    // Delete in order: humanTasks → actionTraces → messages → chatMemory → case
    await prisma.humanTask.deleteMany({ where: { caseId } })
    await prisma.actionTrace.deleteMany({ where: { caseId } })
    await prisma.message.deleteMany({ where: { caseId } })
    await prisma.chatMemory.deleteMany({ where: { caseId } })
    await prisma.case.deleteMany({ where: { id: caseId } })

    return new Response(JSON.stringify({ ok: true, deletedCaseId: caseId }), { status: 200 })
  } catch (err) {
    console.error('[DeleteCase] Error:', err)
    return new Response(JSON.stringify({ error: 'Delete failed' }), { status: 500 })
  }
}
