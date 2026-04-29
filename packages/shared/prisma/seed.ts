// [MOCK] Seed script — creates demo data for human tasks UI
// Run: npx tsx packages/shared/prisma/seed.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function seed() {
  console.log('Seeding…')

  // Clean old seed data
  await prisma.humanTask.deleteMany({ where: { id: 'seed-task-1' } })
  await prisma.actionTrace.deleteMany({ where: { caseId: 'seed-case-1' } })
  await prisma.message.deleteMany({ where: { caseId: 'seed-case-1' } })
  await prisma.caseMemory.deleteMany({ where: { caseId: 'seed-case-1' } })
  await prisma.case.deleteMany({ where: { id: 'seed-case-1' } })
  await prisma.customer.deleteMany({ where: { id: 'seed-customer' } })

  const customer = await prisma.customer.create({
    data: { id: 'seed-customer', name: 'Demo Vendor' },
  })

  const c = await prisma.case.create({
    data: {
      id: 'seed-case-1',
      customerId: customer.id,
      userId: 'u_try_1',
      type: 'deposit_issue',
      status: 'waiting_human',
      goal: 'Confirm whether the deposit has arrived; if not, request a reissue',
      blocker: 'Waiting for payment_ops to confirm channel batch status',
    },
  })

  await prisma.caseMemory.create({
    data: {
      caseId: c.id,
      confirmedFacts: JSON.stringify({ txnId: 'TXU1_12345', amount: 500, userReportedNotReceived: true, orderStatus: 'pending', channelDelayedBatch: true }),
      missingFacts: JSON.stringify(['receipt_screenshot']),
      skillsCalled: JSON.stringify(['query_order_status', 'query_payment_channel_status']),
      skillResults: JSON.stringify({
        query_order_status: { status: 'pending', amount: 500, time: '2026-04-28T10:00:00Z' },
        query_payment_channel_status: { delayed_batch: true, channel: 'wechat_pay', reason: 'Batch processing delay' },
      }),
      keyEvents: JSON.stringify([
        { at: '2026-04-28T10:00:00Z', text: 'User reported deposit of 500 CNY not received' },
        { at: '2026-04-28T10:01:00Z', text: 'Agent queried order status: pending' },
        { at: '2026-04-28T10:02:00Z', text: 'Agent queried payment channel: delayed batch detected' },
        { at: '2026-04-28T10:03:00Z', text: 'Agent created human task for payment_ops' },
      ]),
    },
  })

  await prisma.message.createMany({
    data: [
      { caseId: c.id, role: 'user', content: 'I deposited 500 yuan yesterday, order TXU1_12345, not received yet' },
      { caseId: c.id, role: 'assistant', content: 'I understand. Let me check your transaction.' },
    ],
  })

  await prisma.actionTrace.createMany({
    data: [
      { caseId: c.id, actionType: 'user_message', title: 'User reported deposit issue' },
      { caseId: c.id, actionType: 'skill_called', title: 'Skill called: query_order_status' },
      { caseId: c.id, actionType: 'skill_result', title: 'Skill result: query_order_status' },
      { caseId: c.id, actionType: 'skill_called', title: 'Skill called: query_payment_channel_status' },
      { caseId: c.id, actionType: 'skill_result', title: 'Skill result: query_payment_channel_status' },
      { caseId: c.id, actionType: 'human_task_created', title: 'Human task created for payment_ops' },
    ],
  })

  await prisma.humanTask.create({
    data: {
      id: 'seed-task-1',
      caseId: c.id,
      queue: 'payment_ops',
      status: 'pending',
      question:
        'Customer deposited 500 CNY via WeChat Pay. Our system shows "pending" but the channel reports a delayed batch. Can you confirm: (1) Is this batch being processed? (2) What is the expected ETA? (3) Should we advise the customer to wait or request a reissue?',
    },
  })

  console.log('Seed complete.')
}

seed().catch(console.error).finally(() => prisma.$disconnect())
