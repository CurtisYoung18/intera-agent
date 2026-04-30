// Seed script — creates demo data for human tasks UI + admin config
// Run: npx tsx packages/shared/prisma/seed.ts

import { PrismaClient } from '@prisma/client'
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MEMORY_STRATEGY,
  DEFAULT_POLICY_HOOKS,
  DEFAULT_SKILLS,
  DEFAULT_POLICIES,
  DEFAULT_CASE_TYPES,
  DEFAULT_ROUTING,
} from '../defaults/index'

const prisma = new PrismaClient()
const CUSTOMER_ID = 'default'

async function seed() {
  console.log('Seeding…')

  // ── Clean old demo data ──
  await prisma.humanTask.deleteMany({ where: { id: 'seed-task-1' } })
  await prisma.actionTrace.deleteMany({ where: { caseId: 'seed-case-1' } })
  await prisma.message.deleteMany({ where: { caseId: 'seed-case-1' } })
  await prisma.caseMemory.deleteMany({ where: { caseId: 'seed-case-1' } })
  await prisma.case.deleteMany({ where: { id: 'seed-case-1' } })

  // Ensure default customer exists
  await prisma.customer.upsert({
    where: { id: CUSTOMER_ID },
    update: { name: 'Demo Vendor' },
    create: { id: CUSTOMER_ID, name: 'Demo Vendor' },
  })

  // ── Admin: AgentConfig ──
  await prisma.agentConfig.upsert({
    where: { customerId: CUSTOMER_ID },
    update: {},
    create: {
      customerId: CUSTOMER_ID,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      temperature: 0.5,
      thinkingBudget: 4096,
      maxIterations: 20,
      memoryStrategy: JSON.stringify(DEFAULT_MEMORY_STRATEGY),
      policyHooks: JSON.stringify(DEFAULT_POLICY_HOOKS),
    },
  })
  console.log('  ✓ AgentConfig')

  // ── Admin: Skills ──
  for (const s of DEFAULT_SKILLS) {
    await prisma.skill.upsert({
      where: { customerId_name: { customerId: CUSTOMER_ID, name: s.name } },
      update: {},
      create: {
        customerId: CUSTOMER_ID,
        name: s.name,
        description: s.description,
        inputSchema: s.inputSchema,
        outputSchema: s.outputSchema,
        mode: s.mode,
        isConcurrencySafe: s.isConcurrencySafe,
        enabled: s.enabled,
        guardPhase: s.guardPhase,
      },
    })
  }
  console.log(`  ✓ ${DEFAULT_SKILLS.length} Skills`)

  // ── Admin: Policies ──
  for (const p of DEFAULT_POLICIES) {
    await prisma.policy.upsert({
      where: { customerId_name: { customerId: CUSTOMER_ID, name: p.name } },
      update: {},
      create: {
        customerId: CUSTOMER_ID,
        name: p.name,
        description: p.description,
        hook: p.hook,
        rule: p.rule,
        enabled: true,
      },
    })
  }
  console.log(`  ✓ ${DEFAULT_POLICIES.length} Policies`)

  // ── Admin: Case Types ──
  for (const ct of DEFAULT_CASE_TYPES) {
    await prisma.caseType.upsert({
      where: { customerId_type: { customerId: CUSTOMER_ID, type: ct.type } },
      update: {},
      create: {
        customerId: CUSTOMER_ID,
        type: ct.type,
        displayName: ct.displayName,
        description: ct.description,
        icon: ct.icon,
        requiredFacts: ct.requiredFacts,
        stages: ct.stages,
        defaultGoal: ct.defaultGoal,
        escalateOn: ct.escalateOn,
      },
    })
  }
  console.log(`  ✓ ${DEFAULT_CASE_TYPES.length} Case Types`)

  // ── Admin: Routing ──
  for (const r of DEFAULT_ROUTING) {
    await prisma.routing.upsert({
      where: { customerId_queue: { customerId: CUSTOMER_ID, queue: r.queue } },
      update: {},
      create: {
        customerId: CUSTOMER_ID,
        queue: r.queue,
        description: r.description,
        skillsAllowed: r.skillsAllowed,
        priority: r.priority,
      },
    })
  }
  console.log(`  ✓ ${DEFAULT_ROUTING.length} Routing queues`)

  // ── Demo data: Case + Memory + Messages + Traces + HumanTask ──
  const c = await prisma.case.create({
    data: {
      id: 'seed-case-1',
      customerId: CUSTOMER_ID,
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
