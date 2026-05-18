// GET + PUT /api/admin/agent — Agent config CRUD (upsert)

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureSqliteSchemaCompat } from '@intera/shared/prisma'
import { clampComposerMinDraftChars } from '@intera/shared/composer-min-draft'
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_MEMORY_STRATEGY, DEFAULT_POLICY_HOOKS } from '@intera/shared/defaults'

const CUSTOMER_ID = 'default'

export async function GET() {
  try {
    await ensureSqliteSchemaCompat(prisma)
    let config = await prisma.agentConfig.findUnique({ where: { customerId: CUSTOMER_ID } })

    // Lazy init: create from defaults if DB is empty
    if (!config) {
      config = await prisma.agentConfig.create({
        data: {
          customerId: CUSTOMER_ID,
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          model: 'MiniMax-M2.7-highspeed',
          temperature: 0.5,
          thinkingBudget: 4096,
          maxIterations: 20,
          maxOutputTokens: 4096,
          toolParallelism: true,
          isConcurrencySafe: true,
          showThinking: false,
          resumePrompt: null,
          formResponseTemplate: null,
          evaluationModel: null,
          intentModel: null,
          memoryStrategy: JSON.stringify(DEFAULT_MEMORY_STRATEGY),
          policyHooks: JSON.stringify(DEFAULT_POLICY_HOOKS),
        },
      })
    }

    return NextResponse.json({ config })
  } catch (err) {
    console.error('[Admin] GET agent config:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    await ensureSqliteSchemaCompat(prisma)
    const body = await req.json()
    const {
      model, temperature, thinkingBudget, maxIterations, maxOutputTokens,
      systemPrompt, toolParallelism, isConcurrencySafe,
      showThinking, memoryStrategy, policyHooks,
      resumePrompt, formResponseTemplate, humanSkills, consultationPrompt,
      evaluationModel, intentModel,
      prefixContinuationEnabled,
      prefixContinuationChatModel,
      prefixContinuationBaseUrl,
      prefixContinuationAssistantPrefix,
      prefixContinuationStop,
      prefixContinuationMinDraftChars,
    } = body

    const data: Record<string, unknown> = {}
    if (model !== undefined) data.model = model
    if (temperature !== undefined) data.temperature = temperature
    if (thinkingBudget !== undefined) data.thinkingBudget = thinkingBudget
    if (maxIterations !== undefined) data.maxIterations = maxIterations
    if (maxOutputTokens !== undefined) data.maxOutputTokens = maxOutputTokens
    if (systemPrompt !== undefined) data.systemPrompt = systemPrompt
    if (toolParallelism !== undefined) data.toolParallelism = toolParallelism
    if (isConcurrencySafe !== undefined) data.isConcurrencySafe = isConcurrencySafe
    if (showThinking !== undefined) data.showThinking = showThinking
    if (memoryStrategy !== undefined) data.memoryStrategy = typeof memoryStrategy === 'string' ? memoryStrategy : JSON.stringify(memoryStrategy)
    if (policyHooks !== undefined) data.policyHooks = typeof policyHooks === 'string' ? policyHooks : JSON.stringify(policyHooks)
    if (resumePrompt !== undefined) data.resumePrompt = resumePrompt
    if (formResponseTemplate !== undefined) data.formResponseTemplate = formResponseTemplate
    if (humanSkills !== undefined) data.humanSkills = humanSkills
    if (consultationPrompt !== undefined) data.consultationPrompt = consultationPrompt
    if (evaluationModel !== undefined) data.evaluationModel = evaluationModel
    if (intentModel !== undefined) data.intentModel = intentModel
    if (prefixContinuationEnabled !== undefined)
      data.prefixContinuationEnabled = prefixContinuationEnabled !== false && prefixContinuationEnabled !== 0 && prefixContinuationEnabled !== 'false'
    if (prefixContinuationChatModel !== undefined) data.prefixContinuationChatModel = prefixContinuationChatModel
    if (prefixContinuationBaseUrl !== undefined) data.prefixContinuationBaseUrl = prefixContinuationBaseUrl
    if (prefixContinuationAssistantPrefix !== undefined) data.prefixContinuationAssistantPrefix = prefixContinuationAssistantPrefix
    if (prefixContinuationStop !== undefined) data.prefixContinuationStop = prefixContinuationStop
    if (prefixContinuationMinDraftChars !== undefined) {
      data.prefixContinuationMinDraftChars = clampComposerMinDraftChars(prefixContinuationMinDraftChars, 4)
    }

    const config = await prisma.agentConfig.upsert({
      where: { customerId: CUSTOMER_ID },
      update: data,
      create: {
        customerId: CUSTOMER_ID,
        systemPrompt: systemPrompt || '',
        model: model || 'MiniMax-M2.7-highspeed',
        temperature: temperature ?? 0.5,
        thinkingBudget: thinkingBudget ?? 4096,
        maxIterations: maxIterations ?? 20,
        maxOutputTokens: maxOutputTokens ?? 4096,
        toolParallelism: toolParallelism ?? true,
        isConcurrencySafe: isConcurrencySafe ?? true,
        showThinking: showThinking ?? false,
        resumePrompt: resumePrompt ?? null,
        formResponseTemplate: formResponseTemplate ?? null,
        humanSkills: humanSkills ?? null,
        consultationPrompt: consultationPrompt ?? null,
        evaluationModel: evaluationModel ?? null,
        intentModel: intentModel ?? null,
        prefixContinuationEnabled:
          prefixContinuationEnabled !== undefined
            ? prefixContinuationEnabled !== false &&
              prefixContinuationEnabled !== 0 &&
              prefixContinuationEnabled !== 'false'
            : false,
        prefixContinuationChatModel: prefixContinuationChatModel ?? null,
        prefixContinuationBaseUrl: prefixContinuationBaseUrl ?? null,
        prefixContinuationAssistantPrefix: prefixContinuationAssistantPrefix ?? null,
        prefixContinuationStop: prefixContinuationStop ?? null,
        prefixContinuationMinDraftChars: clampComposerMinDraftChars(prefixContinuationMinDraftChars, 4),
        memoryStrategy: typeof memoryStrategy === 'string' ? memoryStrategy : JSON.stringify(memoryStrategy || {}),
        policyHooks: typeof policyHooks === 'string' ? policyHooks : JSON.stringify(policyHooks || {}),
      },
    })

    return NextResponse.json({ config })
  } catch (err) {
    console.error('[Admin] PUT agent config:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
