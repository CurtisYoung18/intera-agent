// Seed script — creates demo data for human tasks UI + agent-scoped config
// Run from repo root: `npm run db:seed`
// Loads `.env.local` / `.env` so `DATABASE_URL` and API model env vars match your machine.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotEnv } from 'dotenv'
import { PrismaClient } from '@prisma/client'

import { hashSync } from 'bcryptjs'
import {
  DEFAULT_MODEL,
  CORE_SYSTEM_PROMPT,
  DEFAULT_MEMORY_STRATEGY,
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

// ── Agent-scoped seed data ────────────────────────────────────────────

const AGENT_ID = 'agent_default_v1'

const SEED_TOOLS = [
  {
    name: 'read_chat_memory',
    description: 'Read the per-case working memory for the current investigation. Returns tool history, key events, compact summary, open items, and missing-info stats. It does not return ProcedureRun authority or hidden runtime state.',
    inputSchema: JSON.stringify({ type: 'object', properties: {}, required: [] }),
    outputSchema: JSON.stringify({
      type: 'object',
      properties: {
        scope: { type: 'string' },
        authority: { type: 'string' },
        toolsCalled: { type: 'array', items: { type: 'string' } },
        keyEvents: { type: 'array', items: { type: 'object' } },
        compactSummary: { type: 'string' },
        openItems: { type: 'array', items: { type: 'object' } },
        stats: { type: 'object' },
      },
    }),
    mode: 'system_managed',
    guardPhase: 'post',
    toolCategory: 'system_info',
    isConcurrencySafe: true,
    enabled: true,
  },
  {
    name: 'read_user_profile',
    description: 'Read the user profile for the current customer. Contains user attributes, preferences, tags, and cross-chat statistics.',
    inputSchema: JSON.stringify({ type: 'object', properties: {}, required: [] }),
    outputSchema: JSON.stringify({ type: 'object', properties: { profile: { type: 'string' }, stats: { type: 'object' } } }),
    mode: 'system_managed',
    guardPhase: 'post',
    toolCategory: 'system_info',
    isConcurrencySafe: true,
    enabled: true,
  },
  {
    name: 'create_human_task',
    description: 'Create a structured task for a human operator to review, investigate, or decide.',
    inputSchema: JSON.stringify({
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Target operator queue (e.g. payment_ops, account_ops)' },
        question: { type: 'string', description: 'Detailed question or context for the human operator' },
      },
      required: ['queue', 'question'],
    }),
    outputSchema: JSON.stringify({
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'resolved'] },
      },
    }),
    mode: 'system_managed',
    guardPhase: 'pre',
    toolCategory: 'operational',
    isConcurrencySafe: true,
    enabled: true,
  },
  {
    name: 'ask_user_questions',
    description: 'Collect structured information from the user via a form. Use this instead of plain-text questions.',
    inputSchema: JSON.stringify({
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Field identifier (e.g. txnId, amount, member_id)' },
              label: { type: 'string', description: 'User-visible question text' },
              required: { type: 'boolean', default: false },
            },
          },
        },
        title: { type: 'string', description: 'Optional form title' },
      },
      required: ['fields'],
    }),
    outputSchema: JSON.stringify({
      type: 'object',
      properties: {
        answers: { type: 'object', description: 'Map of field key -> user-provided value' },
      },
    }),
    mode: 'channel',
    guardPhase: 'pre',
    toolCategory: 'operational',
    isConcurrencySafe: true,
    enabled: true,
  },
]

const SEED_HOOKS = [
  {
    name: 'no_high_risk_account_change',
    description: 'Block high-risk account mutations (refund, ban, delete) in preTool phase',
    checkpoint: 'PreToolUse',
    handlerKind: 'declarative',
    handler: JSON.stringify({
      kind: 'declarative',
      check: {
        kind: 'rule',
        match: { tools: ['refund_money', 'change_ban_status', 'delete_account'] },
        denyTools: ['refund_money', 'change_ban_status', 'delete_account'],
      },
      effect: {
        decision: 'block',
        guidance: 'High-risk account changes are not allowed. Escalate to human if needed.',
      },
    }),
    severity: 'critical',
    enabled: true,
  },
  {
    name: 'investigate_before_resolve',
    description: 'Require evidence gathering before case finalization',
    checkpoint: 'Stop',
    handlerKind: 'declarative',
    handler: JSON.stringify({
      kind: 'declarative',
      check: {
        kind: 'ai',
        evaluationPrompt:
          'Check whether the finalize conclusion cites evidence gathered during case investigation.\n\nFinalize output: {{tool_output}}\nTools called: {{tools_called}}\n\nBlock (result=blocked) if the conclusion makes claims without any factual grounding.\nPass if evidence is properly cited and the reasoning is traceable to runtime evidence.',
      },
      effect: {
        decision: 'block',
        guidance: 'Conclusions must cite specific evidence. Reference tool results or knowledge base articles.',
      },
    }),
    severity: 'high',
    enabled: true,
  },
  {
    name: 'human_review_before_finalize',
    description: 'Require human review before case finalization when activated by a case type',
    checkpoint: 'Stop',
    handlerKind: 'declarative',
    handler: JSON.stringify({
      kind: 'declarative',
      check: {
        kind: 'rule',
        requireTools: ['create_human_task'],
      },
      effect: {
        decision: 'block',
        guidance: 'Call create_human_task before finalizing this case.',
      },
    }),
    severity: 'high',
    enabled: true,
  },
]

const SEED_CASE_TYPES = [
  {
    type: 'general_inquiry',
    displayName: 'General Inquiry',
    description: 'General customer questions, information requests, how-to guidance, and platform policy inquiries.',
    icon: '💬',
    requiredFacts: '[]',
    defaultGoal: 'Answer the customer question accurately using knowledge base and available tools.',
    escalateOn: '[]',
    procedure: null,
    maxAutoTurns: 10,
    hookBindings: [],
    enabled: true,
  },
  {
    type: 'deposit_issue',
    displayName: 'Deposit not credited',
    description:
      'The customer says they topped up or transferred funds but their balance did not increase. Includes "charged but balance unchanged" and "still not credited after a long time".',
    icon: '💰',
    requiredFacts: '["txnId","amount","paymentMethod","date"]',
    defaultGoal: 'Verify the order and payment-channel status; determine whether it is delayed, failed, or needs a manual top-up. Escalate to a human when system data conflicts with the customer report.',
    escalateOn: '["conflict"]',
    procedure: JSON.stringify({
      version: 'v2',
      whenToUse: 'Use when the customer says a deposit or transfer was charged but their balance did not increase or no confirmation appeared.',
      overview: 'Collect the deposit facts, verify order and payment-channel evidence, then either hand off a conflict or finalize with grounded evidence.',
      handoffGuidance: 'Escalate to payment_ops when the tool evidence conflicts with the customer report or a manual reissue review is required.',
      steps: [
        {
          id: 'collect_facts',
          title: 'Collect deposit facts',
          guidance: 'Collect transaction ID, amount, payment method, and date before investigation.',
          actions: [
            {
              id: 'ask_deposit_facts',
              kind: 'ask',
              label: 'Ask for deposit facts',
              fields: ['txnId', 'amount', 'paymentMethod', 'date'],
            },
          ],
        },
        {
          id: 'investigate_order',
          title: 'Investigate order and channel',
          guidance: 'Check order status and payment-channel status, then reconcile the evidence with the customer report.',
          actions: [
            {
              id: 'query_order_status',
              kind: 'call_tool',
              label: 'Check order status',
              toolName: 'query_order_status',
            },
            {
              id: 'query_payment_channel_status',
              kind: 'call_tool',
              label: 'Check payment channel status',
              toolName: 'query_payment_channel_status',
            },
          ],
          branches: [
            {
              id: 'conflict_or_manual_review',
              kind: 'if',
              condition: {
                kind: 'llm_eval',
                prompt: 'Based on the order evidence, payment-channel evidence, and the customer report, is there a conflict or manual review need that requires payment_ops handoff?',
              },
              actions: [
                {
                  id: 'handoff_payment_ops',
                  kind: 'request_human_handoff',
                  label: 'Request payment ops review',
                  queue: 'payment_ops',
                },
              ],
            },
          ],
          completionGuidance: 'Do not finalize until the deposit evidence is reconciled or a human handoff is persisted.',
        },
        {
          id: 'finalize',
          title: 'Finalize customer answer',
          guidance: 'Give a clear customer-facing answer grounded in collected evidence.',
          actions: [
            {
              id: 'finish_customer_answer',
              kind: 'end',
              label: 'Finalize customer answer',
              status: 'completed',
            },
          ],
        },
      ],
    }),
    maxAutoTurns: 10,
    hookBindings: ['investigate_before_resolve', 'human_review_before_finalize'],
    enabled: true,
  },
]

// ── Organization definitions ────────────────────────────────────────────

const VENDORS = [
  { id: 'default', name: 'Test', password: null },
  { id: 'demo', name: 'Demo', password: null },
]

// ── Seed helpers ────────────────────────────────────────────────────

async function seedAgentConfig(orgId: string, agentId: string) {
  const agentPayload = {
    id: agentId,
    orgId,
    name: 'Default',
    version: 1,
    isActive: true,
    coreSystemPrompt: CORE_SYSTEM_PROMPT,
    model: DEFAULT_MODEL,
    temperature: 0.5,
    thinkingBudget: 4096,
    maxIterations: 20,
    maxOutputTokens: 4096,
    memoryStrategy: JSON.stringify(DEFAULT_MEMORY_STRATEGY),
    extendedThinking: true,
    resumePrompt:
      '[Human task resolved — operator closed the case]\nIMPORTANT: translate the verdict into plain, friendly customer language and send it now.',
  }

  await prisma.agentConfig.upsert({
    where: { id: agentId },
    update: agentPayload,
    create: agentPayload,
  })
  console.log(`  ✓ AgentConfig (${agentId})`)

  // Tools — agent-scoped
  for (const t of SEED_TOOLS) {
    await prisma.tool.upsert({
      where: { agentConfigId_name: { agentConfigId: agentId, name: t.name } },
      update: {
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        mode: t.mode,
        guardPhase: t.guardPhase,
        toolCategory: t.toolCategory,
        isConcurrencySafe: t.isConcurrencySafe,
        enabled: t.enabled,
      },
      create: {
        agentConfigId: agentId,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        mode: t.mode,
        guardPhase: t.guardPhase,
        toolCategory: t.toolCategory,
        isConcurrencySafe: t.isConcurrencySafe,
        enabled: t.enabled,
      },
    })
  }
  console.log(`  ✓ ${SEED_TOOLS.length} Tools (${agentId})`)

  // Hooks — agent-scoped
  for (const h of SEED_HOOKS) {
    await prisma.hook.upsert({
      where: { agentConfigId_name: { agentConfigId: agentId, name: h.name } },
      update: {
        description: h.description,
        checkpoint: h.checkpoint,
        handlerKind: h.handlerKind,
        handler: h.handler,
        severity: h.severity,
        enabled: h.enabled,
      },
      create: {
        agentConfigId: agentId,
        name: h.name,
        description: h.description,
        checkpoint: h.checkpoint,
        handlerKind: h.handlerKind,
        handler: h.handler,
        severity: h.severity,
        enabled: h.enabled,
      },
    })
  }
  console.log(`  ✓ ${SEED_HOOKS.length} Hooks (${agentId})`)

  const safetyHook = await prisma.hook.findUnique({
    where: { agentConfigId_name: { agentConfigId: agentId, name: 'no_high_risk_account_change' } },
  })
  if (safetyHook) {
    await prisma.hookBinding.upsert({
      where: {
        agentConfigId_hookId_scopeKey: {
          agentConfigId: agentId,
          hookId: safetyHook.id,
          scopeKey: 'agent',
        },
      },
      update: { enabled: true, scopeType: 'agent' },
      create: {
        agentConfigId: agentId,
        hookId: safetyHook.id,
        scopeType: 'agent',
        scopeKey: 'agent',
        enabled: true,
      },
    })
  }

  // Case Types — agent-scoped
  for (const ct of SEED_CASE_TYPES) {
    const caseType = await prisma.caseType.upsert({
      where: { agentConfigId_type: { agentConfigId: agentId, type: ct.type } },
      update: {
        displayName: ct.displayName,
        description: ct.description,
        icon: ct.icon,
        requiredFacts: ct.requiredFacts,
        defaultGoal: ct.defaultGoal,
        escalateOn: ct.escalateOn,
        procedure: ct.procedure,
        maxAutoTurns: ct.maxAutoTurns,
        enabled: ct.enabled,
      },
      create: {
        agentConfigId: agentId,
        type: ct.type,
        displayName: ct.displayName,
        description: ct.description,
        icon: ct.icon,
        requiredFacts: ct.requiredFacts,
        defaultGoal: ct.defaultGoal,
        escalateOn: ct.escalateOn,
        procedure: ct.procedure,
        maxAutoTurns: ct.maxAutoTurns,
        enabled: ct.enabled,
      },
    })

    for (const hookName of ct.hookBindings ?? []) {
      const hook = await prisma.hook.findUnique({
        where: { agentConfigId_name: { agentConfigId: agentId, name: hookName } },
      })
      if (!hook) continue
      await prisma.hookBinding.upsert({
        where: {
          agentConfigId_hookId_scopeKey: {
            agentConfigId: agentId,
            hookId: hook.id,
            scopeKey: `caseType:${caseType.id}`,
          },
        },
        update: {
          enabled: true,
          scopeType: 'caseType',
          caseTypeId: caseType.id,
        },
        create: {
          agentConfigId: agentId,
          hookId: hook.id,
          scopeType: 'caseType',
          scopeKey: `caseType:${caseType.id}`,
          caseTypeId: caseType.id,
          enabled: true,
        },
      })
    }
  }
  console.log(`  ✓ ${SEED_CASE_TYPES.length} Case Types (${agentId})`)
}

// ── Main seed ────────────────────────────────────────────────────────

async function seed() {
  console.log('Seeding...')

  // ── Clean old demo data ──
  await prisma.humanTask.deleteMany({ where: { id: 'seed-task-1' } })
  await prisma.actionTrace.deleteMany({ where: { caseId: 'seed-case-1' } })
  await prisma.message.deleteMany({ where: { caseId: 'seed-case-1' } })
  await prisma.chatMemory.deleteMany({ where: { caseId: 'seed-case-1' } })
  await prisma.case.deleteMany({ where: { id: 'seed-case-1' } })

  // ── Create vendors ──
  for (const c of VENDORS) {
    await prisma.organization.upsert({
      where: { id: c.id },
      update: { name: c.name, password: c.password },
      create: { id: c.id, name: c.name, password: c.password },
    })
  }
  console.log(`  ✓ ${VENDORS.length} Vendors`)

  // ── Bootstrap owner user ──
  const staffPassword = process.env.STAFF_PASSWORD
  if (staffPassword) {
    const ownerEmail = process.env.SEED_OWNER_EMAIL || 'admin@intera.local'
    const existingUser = await prisma.user.findUnique({ where: { email: ownerEmail } })
    if (!existingUser) {
      const user = await prisma.user.create({
        data: {
          email: ownerEmail,
          name: 'Intera Admin',
          passwordHash: hashSync(staffPassword, 10),
        },
      })
      await prisma.membership.create({
        data: { userId: user.id, orgId: 'default', role: 'owner' },
      })
      console.log(`  ✓ Owner user created: ${ownerEmail}`)
    } else {
      // Update password if STAFF_PASSWORD changed
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { passwordHash: hashSync(staffPassword, 10) },
      })
      // Ensure membership exists
      await prisma.membership.upsert({
        where: { userId_orgId: { userId: existingUser.id, orgId: 'default' } },
        update: { role: 'owner' },
        create: { userId: existingUser.id, orgId: 'default', role: 'owner' },
      })
      console.log(`  ✓ Owner user updated: ${ownerEmail}`)
    }
  }

  // ── Agent Config: default org ──
  console.log('\n── Agent Config ──')
  await seedAgentConfig('default', AGENT_ID)

  // ── Demo data: Case + Memory + Messages + Traces + HumanTask ──
  const c = await prisma.case.create({
    data: {
      id: 'seed-case-1',
      orgId: 'default',
      userId: 'u_try_1',
      chatId: 'seed-chat-1',
      type: 'deposit_issue',
      status: 'waiting_human',
      goal: 'Confirm whether the deposit has arrived; if not, request a reissue',
      blocker: 'Waiting for payment_ops to confirm channel batch status',
    },
  })

  await prisma.chatMemory.create({
    data: {
      caseId: c.id,
      contextMap: JSON.stringify({ txnId: 'TXU1_12345', amount: 500, userReportedNotReceived: true, orderStatus: 'pending', channelDelayedBatch: true }),
      missingFacts: JSON.stringify(['receipt_screenshot']),
      toolsCalled: JSON.stringify(['query_order_status', 'query_payment_channel_status']),
      toolResults: JSON.stringify({
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
      { caseId: c.id, actionType: 'tool_call', title: 'Tool called: query_order_status' },
      { caseId: c.id, actionType: 'tool_result', title: 'Tool result: query_order_status' },
      { caseId: c.id, actionType: 'tool_call', title: 'Tool called: query_payment_channel_status' },
      { caseId: c.id, actionType: 'tool_result', title: 'Tool result: query_payment_channel_status' },
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
        'Customer deposited 500 Taka via bKash. Our system shows "pending" but the channel reports a delayed batch. Can you confirm: (1) Is this batch being processed? (2) What is the expected ETA? (3) Should we advise the customer to wait or request a reissue?',
    },
  })

  console.log('\nSeed complete.')
}

seed().catch(console.error).finally(() => prisma.$disconnect())
