import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'local-regression'

const prisma = new PrismaClient()
const AGENT_ID = process.env.J1N_AGENT_ID || 'cmqg08ite0001qjpuhgzjwyfw'
const ORG_ID = process.env.J1N_ORG_ID || 'default'
const CASE_FOLDER = process.env.J1N_CASE_FOLDER || '/Users/curtis/Desktop/J1N-case-flows-2026-06-18'
const STAMP = process.env.J1N_REGRESSION_STAMP || `j1n_reg_${Date.now().toString(36)}`
let routePost: ((request: NextRequest) => Promise<Response>) | null = null

async function postRoute(): Promise<(request: NextRequest) => Promise<Response>> {
  if (routePost) return routePost
  routePost = (await import('../apps/console/app/api/messages/route')).POST as (request: NextRequest) => Promise<Response>
  return routePost
}

type TurnResult = { status: number; events: any[]; text: string }
type DbFacts = Awaited<ReturnType<typeof dbFacts>>
type CaseContext = {
  caseId: string
  userId: string
  chatId: string
  failures: string[]
  check: (condition: boolean, message: string) => void
}

function imageBlock(name: string): any[] {
  const data = readFileSync(resolve(CASE_FOLDER, name)).toString('base64')
  return [
    { type: 'text', text: `Customer uploaded image: ${name}` },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
  ]
}

async function readSse(res: Response): Promise<any[]> {
  const text = await res.text()
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const raw = chunk.replace(/^data: /, '')
      try {
        return JSON.parse(raw)
      } catch {
        return { parseError: raw }
      }
    })
}

async function send(body: Record<string, unknown>): Promise<TurnResult> {
  const req = new NextRequest('http://localhost/api/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-intera-internal': process.env.INTERNAL_API_SECRET || 'local-regression',
      'x-intera-org': ORG_ID,
      'x-intera-agent-config-id': AGENT_ID,
    },
    body: JSON.stringify({ orgId: ORG_ID, configId: AGENT_ID, ...body }),
  })
  const res = await (await postRoute())(req)
  const events = await readSse(res)
  return {
    status: res.status,
    events,
    text: events
      .filter((event) => event.type === 'text_delta')
      .map((event) => String(event.data ?? ''))
      .join(''),
  }
}

function latestForm(events: any[]): any | undefined {
  return [...events].reverse().find((event) => event.type === 'form_request')?.data
}

function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text)
}

function eventHumanTaskCount(events: any[]): number {
  return events.filter((event) => event.type === 'human_task_created').length
}

function formHasField(form: any, field: string): boolean {
  return Array.isArray(form?.fields) && form.fields.some((candidate: any) => {
    const id = String(candidate.id ?? candidate.key ?? '').toLowerCase()
    const label = String(candidate.label ?? '').toLowerCase()
    return id === field || label.includes(field.replace('_', ' '))
  })
}

async function submitForm(
  ctx: CaseContext,
  form: any,
  answers: Record<string, string>,
): Promise<TurnResult> {
  return send({
    userId: ctx.userId,
    chatId: ctx.chatId,
    formResult: {
      caseId: form.caseId,
      toolCallId: form.toolCallId,
      title: form.title,
      description: form.description,
      fields: form.fields,
      answers,
    },
  })
}

async function dbFacts(caseId: string) {
  const [row, traces, runs, tasks] = await Promise.all([
    prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, type: true, status: true, blocker: true },
    }),
    prisma.actionTrace.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      select: { actionType: true, title: true, detail: true, payload: true },
    }),
    prisma.procedureRun.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      select: { procedureId: true, status: true },
    }),
    prisma.humanTask.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, queue: true },
    }),
  ])
  const tools = traces
    .filter((trace) => trace.actionType === 'tool_result' || /^Tool: /.test(trace.title || ''))
    .map((trace) => (trace.title || '').replace(/^Tool: /, '').trim())
    .filter(Boolean)
  return { row, traces, runs, tasks, tools }
}

const cases: Array<{
  id: string
  expectType?: string
  run: (ctx: CaseContext) => Promise<TurnResult[]>
  validate?: (ctx: CaseContext, facts: DbFacts, turns: TurnResult[]) => void
}> = [
  {
    id: '01',
    expectType: 'j1n_deposit_status',
    async run(ctx) {
      const t1 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'I made a bank transfer deposit but my balance is still not updated.',
      })
      const form = latestForm(t1.events)
      ctx.check(!!form, 'turn1 should show form')
      ctx.check(formHasField(form, 'member_id'), 'deposit form should collect member_id')
      const t2 = form
        ? await submitForm(ctx, form, {
            member_id: 'JAYA1197202',
            amount: '500',
            method: 'bank transfer',
            time: 'today morning',
          })
        : { status: 0, events: [], text: '' }
      const t3 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'Here is my deposit receipt screenshot.',
        contentBlocks: imageBlock('IMG-01-deposit-receipt-esewa.png'),
      })
      return [t1, t2, t3]
    },
    validate(ctx, facts) {
      ctx.check(facts.tools.includes('check_latest_deposit_status'), 'should call check_latest_deposit_status')
      ctx.check(facts.runs.some((run) => run.procedureId === 'j1n_deposit_status'), 'should have deposit ProcedureRun')
    },
  },
  {
    id: '02',
    expectType: 'j1n_withdrawal_status',
    async run(ctx) {
      const t1 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'mero id JAYA1108F7C ho. withdraw kina hudaina?',
      })
      const t2 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'This is the turnover screenshot.',
        contentBlocks: imageBlock('IMG-02-withdraw-blocked-turnover.png'),
      })
      return [t1, t2]
    },
    validate(ctx, facts, turns) {
      ctx.check(!latestForm(turns[0].events), 'should not ask form when member_id is present')
      ctx.check(facts.tools.includes('turnover_withdraw_condition'), 'should call turnover_withdraw_condition')
      ctx.check(facts.runs.some((run) => run.procedureId === 'j1n_withdrawal_status'), 'should have withdrawal ProcedureRun')
    },
  },
  {
    id: '03',
    async run(ctx) {
      const t1 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'What are your sports welcome bonus terms?',
      })
      const t2 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'Is this promo center screenshot related?',
        contentBlocks: imageBlock('IMG-03-promo-center-generic.png'),
      })
      return [t1, t2]
    },
    validate(ctx, facts) {
      ctx.check(facts.tools.includes('kb_search_promotion'), 'should search Promotion KB')
      ctx.check(
        !facts.tools.some((tool) => ['promotion', 'turnover_promotion_active_status'].includes(tool)),
        'general promo should not call member-specific promo tools',
      )
      ctx.check(facts.tasks.length === 0, 'general promo FAQ should not create human task')
    },
  },
  {
    id: '04',
    expectType: 'j1n_reset_withdrawal_pin',
    async run(ctx) {
      const t1 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'I forgot my withdrawal PIN, please reset it.',
      })
      const form = latestForm(t1.events)
      ctx.check(!!form, 'reset pin should show member_id form')
      ctx.check(formHasField(form, 'member_id'), 'reset pin form should collect member_id')
      const t2 = form ? await submitForm(ctx, form, { member_id: 'JAYA117FFEB' }) : { status: 0, events: [], text: '' }
      return [t1, t2]
    },
    validate(ctx, facts) {
      ctx.check(facts.tools.includes('reset_withdrawal_pin'), 'should call reset_withdrawal_pin')
    },
  },
  {
    id: '05',
    expectType: 'j1n_account_status',
    async run(ctx) {
      const t1 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'My KYC verification is rejected, can you check my account?',
      })
      const form = latestForm(t1.events)
      ctx.check(!!form, 'account KYC should show member_id form')
      ctx.check(formHasField(form, 'member_id'), 'account KYC form should collect member_id')
      const t2 = form ? await submitForm(ctx, form, { member_id: 'JAYA1197202' }) : { status: 0, events: [], text: '' }
      const t3 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'Still rejected, please let a human check.',
        contentBlocks: imageBlock('IMG-05-kyc-review-rejected.png'),
      })
      return [t1, t2, t3]
    },
    validate(ctx, facts) {
      ctx.check(
        facts.tools.includes('get_account_status') || facts.tools.includes('get_id_verification_details'),
        'should call account/KYC live tool',
      )
      ctx.check(
        facts.tasks.length > 0 || facts.tools.includes('create_human_task'),
        'explicit unresolved KYC should create human task',
      )
    },
  },
  {
    id: '06',
    expectType: 'j1n_promotion_check',
    async run(ctx) {
      const t1 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'Do I have World Cup cashback promo active on my account now?',
      })
      const form = latestForm(t1.events)
      ctx.check(!!form, 'member-specific promo should show member_id form')
      ctx.check(formHasField(form, 'member_id'), 'promotion form should collect member_id')
      const t2 = form ? await submitForm(ctx, form, { member_id: 'JAYA1108F7C' }) : { status: 0, events: [], text: '' }
      const t3 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'Here is the promo screenshot.',
        contentBlocks: imageBlock('IMG-06-active-promo-banner.png'),
      })
      return [t1, t2, t3]
    },
    validate(ctx, facts) {
      ctx.check(
        facts.tools.includes('promotion') || facts.tools.includes('turnover_promotion_active_status'),
        'should call member-specific promotion tool',
      )
    },
  },
  {
    id: '07',
    expectType: 'j1n_game_recommendation',
    async run(ctx) {
      const t1 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'Can you recommend games for me based on my account?',
      })
      const form = latestForm(t1.events)
      ctx.check(!!form, 'personalized game recommendation should show member_id form')
      ctx.check(formHasField(form, 'member_id'), 'game recommendation form should collect member_id')
      const t2 = form ? await submitForm(ctx, form, { member_id: 'JAYA1197202' }) : { status: 0, events: [], text: '' }
      return [t1, t2]
    },
    validate(ctx, facts) {
      ctx.check(facts.tools.includes('get_recommend_games'), 'should call get_recommend_games')
    },
  },
  {
    id: '08',
    expectType: 'j1n_bet_history',
    async run(ctx) {
      const t1 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'My last bet result is wrong, please check.',
      })
      const form = latestForm(t1.events)
      ctx.check(!!form, 'bet dispute should show member_id form')
      ctx.check(formHasField(form, 'member_id'), 'bet dispute form should collect member_id')
      const t2 = form ? await submitForm(ctx, form, { member_id: 'JAYA1108F7C' }) : { status: 0, events: [], text: '' }
      const t3 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'This result still looks wrong. human please.',
        contentBlocks: imageBlock('IMG-08-bet-slip-round-result.png'),
      })
      return [t1, t2, t3]
    },
    validate(ctx, facts) {
      ctx.check(facts.tools.includes('get_bet_history'), 'should call get_bet_history')
      ctx.check(
        facts.tasks.length > 0 || facts.tools.includes('create_human_task'),
        'unresolved bet dispute should create human task',
      )
    },
  },
  {
    id: '09',
    expectType: 'j1n_transaction_history',
    async run(ctx) {
      const t1 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'Please check my transaction history records.',
      })
      const form = latestForm(t1.events)
      ctx.check(!!form, 'transaction history should show form')
      ctx.check(formHasField(form, 'member_id'), 'transaction form should include member_id')
      ctx.check(formHasField(form, 'method'), 'transaction form should include method')
      const t2 = form
        ? await submitForm(ctx, form, { member_id: 'JAYA117FFEB', method: 'deposit' })
        : { status: 0, events: [], text: '' }
      return [t1, t2]
    },
    validate(ctx, facts) {
      ctx.check(facts.tools.includes('get_transaction_history'), 'should call get_transaction_history')
    },
  },
  {
    id: '10',
    async run(ctx) {
      const t1 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'help me',
      })
      ctx.check(eventHumanTaskCount(t1.events) === 0, 'generic help should not instantly create human task')
      const t2 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'My member id is JAYA1197202. My deposit still has not arrived.',
      })
      const t3 = await send({
        caseId: ctx.caseId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        message: 'AI cannot solve this, human please.',
      })
      return [t1, t2, t3]
    },
    validate(ctx, facts) {
      ctx.check(facts.tools.includes('remember'), 'natural member_id should trigger remember')
      ctx.check(facts.tools.includes('check_latest_deposit_status'), 'deposit issue should call live deposit tool')
      ctx.check(facts.tasks.length <= 1, 'should not duplicate human task')
    },
  },
]

async function main(): Promise<void> {
  const rows: any[] = []
  for (const testCase of cases) {
    const ctx: CaseContext = {
      caseId: `${STAMP}_${testCase.id}`,
      userId: `${STAMP}_user_${testCase.id}`,
      chatId: `${STAMP}_chat_${testCase.id}`,
      failures: [],
      check(condition, message) {
        if (!condition) this.failures.push(message)
      },
    }
    console.log(`RUN ${testCase.id} ${ctx.caseId}`)
    let turns: TurnResult[] = []
    try {
      turns = await testCase.run(ctx)
    } catch (err) {
      ctx.failures.push(`runtime error: ${err instanceof Error ? err.message : String(err)}`)
    }

    const facts = await dbFacts(ctx.caseId)
    if (testCase.expectType) {
      ctx.check(facts.row?.type === testCase.expectType, `case type ${facts.row?.type} expected ${testCase.expectType}`)
    }
    const allText = turns.map((turn) => turn.text).join('\n')
    ctx.check(!hasDevanagari(allText), 'reply contains Devanagari')
    ctx.check(
      !/I'm sorry|human specialist|support ticket|Thank you for your patience/i.test(allText),
      'reply contains generic English escalation fallback',
    )
    try {
      testCase.validate?.(ctx, facts, turns)
    } catch (err) {
      ctx.failures.push(`validation error: ${err instanceof Error ? err.message : String(err)}`)
    }

    rows.push({
      id: testCase.id,
      status: ctx.failures.length ? 'FAIL' : 'PASS',
      failures: ctx.failures,
      caseType: facts.row?.type,
      caseStatus: facts.row?.status,
      runs: facts.runs.map((run) => `${run.procedureId}:${run.status}`),
      tools: facts.tools,
      tasks: facts.tasks.map((task) => `${task.queue}:${task.status}`),
      textPreview: allText.slice(0, 240),
    })
    console.log(`${testCase.id} ${ctx.failures.length ? 'FAIL' : 'PASS'} type=${facts.row?.type} tools=${facts.tools.join(',')}`)
    if (ctx.failures.length) console.log(`  ${ctx.failures.join(' | ')}`)
  }

  console.log(JSON.stringify({
    stamp: STAMP,
    pass: rows.filter((row) => row.status === 'PASS').length,
    total: rows.length,
    rows,
  }, null, 2))
}

main()
  .finally(async () => {
    await prisma.$disconnect()
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
