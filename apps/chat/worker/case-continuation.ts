// Intera Harness — Case Continuation Worker
// Phase 3: Lightweight DB-polling worker that resumes cases when background
// sub-agents complete. Runs as a standalone Node.js process alongside the
// Next.js server. No Redis/BullMQ required.
//
// Usage: npx tsx worker/case-continuation.ts

import { prisma } from '@intera/shared/prisma'

const API_URL = process.env.NEXT_PUBLIC_CHAT_API_URL || 'http://localhost:3000'
const POLL_INTERVAL_MS = 10_000
const LOCK_TIMEOUT_MS = 120_000 // 2 minutes — stale lock expiry

async function poll(): Promise<void> {
  try {
    const pending = await prisma.chatMemory.findMany({
      where: {
        needsContinuation: true,
        case: {
          status: { in: ['investigating', 'created'] },
        },
        OR: [
          { continuationLock: null },
          { continuationLock: { lt: new Date(Date.now() - LOCK_TIMEOUT_MS) } },
        ],
      },
      include: { case: true },
    })

    for (const mem of pending) {
      console.log(`[Worker] Resuming case ${mem.caseId} (type: ${mem.case.type}, status: ${mem.case.status})`)

      // Acquire lock
      await prisma.chatMemory.update({
        where: { caseId: mem.caseId },
        data: { continuationLock: new Date() },
      })

      // Trigger resume via self-call to /api/messages
      try {
        const res = await fetch(`${API_URL}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message:
              '[System] Background investigation completed. New sub-agent data is available. ' +
              'Review the findings in CaseMemory, advance the stage if conditions are met, ' +
              'and inform the customer of any updates.',
            caseId: mem.caseId,
            vendorId: mem.case.vendorId,
            userId: mem.case.userId,
          }),
        })

        if (!res.ok) {
          console.error(`[Worker] Resume failed for case ${mem.caseId}: HTTP ${res.status}`)
          // Unlock so it can be retried
          await prisma.chatMemory.update({
            where: { caseId: mem.caseId },
            data: { continuationLock: null },
          })
          continue
        }

        // Drain the SSE response body — this waits for the agent loop to
        // complete before we clear the flag. Without draining, fetch() resolves
        // on headers alone and we'd mark the case done before the agent finishes.
        try {
          await res.text()
        } catch {
          // Ignore read errors (stream closed early is acceptable)
        }

        // Success — clear flag and lock
        await prisma.chatMemory.update({
          where: { caseId: mem.caseId },
          data: { needsContinuation: false, continuationLock: null },
        })
        console.log(`[Worker] Case ${mem.caseId} resumed successfully`)
      } catch (err) {
        console.error(`[Worker] Resume error for case ${mem.caseId}:`, err)
        // Unlock on failure, will retry next poll
        await prisma.chatMemory.update({
          where: { caseId: mem.caseId },
          data: { continuationLock: null },
        }).catch(() => { /* ignore unlock failure */ })
      }
    }
  } catch (err) {
    console.error('[Worker] Poll iteration failed:', err)
  }
}

console.log(`[Worker] Case continuation worker starting (API: ${API_URL}, interval: ${POLL_INTERVAL_MS}ms)`)
poll()
setInterval(poll, POLL_INTERVAL_MS)
