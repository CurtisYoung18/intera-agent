// Seed script — creates demo data for human tasks UI + admin config
// Run from repo root: `npm run db:seed`
// Loads `.env.local` / `.env` so `DATABASE_URL` and API model env vars match your machine.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotEnv } from 'dotenv'
import { PrismaClient } from '@prisma/client'

import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MEMORY_STRATEGY,
  DEFAULT_POLICY_HOOKS,
  DEFAULT_SKILLS,
  DEFAULT_POLICIES,
  DEFAULT_CASE_TYPES,
  DEFAULT_ROUTING,
  DEFAULT_STAGE_CONFIGS,
  DEFAULT_ORCHESTRATOR_CONFIG,
  DEFAULT_KNOWLEDGE_SOURCES,
} from '../defaults/index'

function loadEnv(): void {
  let dir = resolve(process.cwd())
  for (let i = 0; i < 10; i++) {
    const local = resolve(dir, '.env.local')
    const plain = resolve(dir, '.env')
    if (existsSync(local)) {
      loadDotEnv({ path: local })
      return
    }
    if (existsSync(plain)) {
      loadDotEnv({ path: plain })
      return
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
}

loadEnv()

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

  // ── Admin: AgentConfig — full demo defaults every run ━━━━━━━━━━━
  const agentPayload = {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    model: 'MiniMax-M2.7-highspeed',
    temperature: 0.5,
    thinkingBudget: 4096,
    maxIterations: 20,
    maxOutputTokens: 4096,
    memoryStrategy: JSON.stringify(DEFAULT_MEMORY_STRATEGY),
    policyHooks: JSON.stringify(DEFAULT_POLICY_HOOKS),
    showThinking: true,
    evaluationModel: process.env.EVALUATION_MODEL || 'MiniMax-M2.7-highspeed',
    resumePrompt:
      `[Human task resolved — operator closed the case]\nIMPORTANT: translate the verdict into plain, friendly customer language and send it now.`,
    formResponseTemplate: 'Please continue processing based on this information.',
    prefixContinuationEnabled: true,
    prefixContinuationChatModel: process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-chat',
    prefixContinuationBaseUrl:
      process.env.DEEPSEEK_BETA_CHAT_BASE_URL?.trim() || 'https://api.deepseek.com/beta',
    prefixContinuationAssistantPrefix:
      "Keep completions brief; mirror the visitor's language; supportive, plain wording.",
    prefixContinuationStop: null as string | null,
    prefixContinuationMinDraftChars: 4,
  }

  await prisma.agentConfig.upsert({
    where: { customerId: CUSTOMER_ID },
    update: agentPayload,
    create: {
      customerId: CUSTOMER_ID,
      ...agentPayload,
    },
  })
  console.log('  ✓ AgentConfig')

  // ── Admin: Skills ──
  for (const s of DEFAULT_SKILLS) {
    await prisma.skill.upsert({
      where: { customerId_name: { customerId: CUSTOMER_ID, name: s.name } },
      update: {
        description: s.description,
        inputSchema: s.inputSchema,
        outputSchema: s.outputSchema,
        mode: s.mode,
        isConcurrencySafe: s.isConcurrencySafe,
        enabled: s.enabled,
        guardPhase: s.guardPhase,
        mockFixture: s.mockFixture ?? null,
        endpoint: s.endpoint ?? null,
        httpMethod: s.httpMethod ?? 'POST',
        headers: s.headers ?? null,
        timeoutMs: s.timeoutMs ?? 8000,
        displayVerb: s.displayVerb ? JSON.stringify(s.displayVerb) : null,
      },
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
        mockFixture: s.mockFixture ?? null,
        endpoint: s.endpoint ?? null,
        httpMethod: s.httpMethod ?? 'POST',
        headers: s.headers ?? null,
        timeoutMs: s.timeoutMs ?? 8000,
        displayVerb: s.displayVerb ? JSON.stringify(s.displayVerb) : null,
      },
    })
  }
  console.log(`  ✓ ${DEFAULT_SKILLS.length} Skills`)

  // ── Admin: Policies ──
  for (const p of DEFAULT_POLICIES) {
    await prisma.policy.upsert({
      where: { customerId_name: { customerId: CUSTOMER_ID, name: p.name } },
      update: {
        description: p.description,
        hook: p.hook,
        rule: p.rule,
        enabled: true,
      },
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

  const orch = JSON.stringify(DEFAULT_ORCHESTRATOR_CONFIG)

  // ── Admin: Case Types ──
  for (const ct of DEFAULT_CASE_TYPES) {
    const stageMap = DEFAULT_STAGE_CONFIGS[ct.type] as Record<string, unknown> | undefined
    await prisma.caseType.upsert({
      where: { customerId_type: { customerId: CUSTOMER_ID, type: ct.type } },
      update: {
        displayName: ct.displayName,
        description: ct.description,
        icon: ct.icon,
        requiredFacts: ct.requiredFacts,
        stages: ct.stages,
        stageConfigs: stageMap ? JSON.stringify(stageMap) : null,
        orchestratorConfig: orch,
        defaultGoal: ct.defaultGoal,
        escalateOn: ct.escalateOn,
        enabled: true,
      },
      create: {
        customerId: CUSTOMER_ID,
        type: ct.type,
        displayName: ct.displayName,
        description: ct.description,
        icon: ct.icon,
        requiredFacts: ct.requiredFacts,
        stages: ct.stages,
        stageConfigs: stageMap ? JSON.stringify(stageMap) : null,
        orchestratorConfig: orch,
        defaultGoal: ct.defaultGoal,
        escalateOn: ct.escalateOn,
        enabled: true,
      },
    })
  }
  console.log(`  ✓ ${DEFAULT_CASE_TYPES.length} Case Types`)

  // ── Admin: Routing ──
  for (const r of DEFAULT_ROUTING) {
    await prisma.routing.upsert({
      where: { customerId_queue: { customerId: CUSTOMER_ID, queue: r.queue } },
      update: {
        description: r.description,
        skillsAllowed: r.skillsAllowed,
        priority: r.priority,
      },
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

  // ── Admin: Knowledge Sources ──
  for (const ks of DEFAULT_KNOWLEDGE_SOURCES) {
    await prisma.knowledgeSource.upsert({
      where: { customerId_name: { customerId: CUSTOMER_ID, name: ks.name } },
      update: {
        description: ks.description ?? null,
        groupIds: ks.groupIds,
        embeddingRate: ks.embeddingRate,
        topK: ks.topK,
        rerankVersion: ks.rerankVersion ?? null,
        docCorrelation: ks.docCorrelation ?? null,
        caseTypeTag: ks.caseTypeTag ?? null,
        enabled: ks.enabled,
      },
      create: {
        customerId: CUSTOMER_ID,
        name: ks.name,
        description: ks.description ?? null,
        groupIds: ks.groupIds,
        embeddingRate: ks.embeddingRate,
        topK: ks.topK,
        rerankVersion: ks.rerankVersion ?? null,
        docCorrelation: ks.docCorrelation ?? null,
        caseTypeTag: ks.caseTypeTag ?? null,
        enabled: ks.enabled,
      },
    })
  }
  console.log(`  ✓ ${DEFAULT_KNOWLEDGE_SOURCES.length} Knowledge Sources`)

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
