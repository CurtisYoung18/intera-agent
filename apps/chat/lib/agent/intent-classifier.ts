// Intera Harness - Intent Classifier
// Lightweight LLM call that maps a user message to either "qa" (casual chat)
// or "case" with matched Case Types. Called before the main AgentLoop.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@intera/shared/prisma'
import type { IntentClassification, MatchedCaseType } from '@intera/shared/types'
import { getCachedCaseTypes, setCachedCaseTypes, type CachedCaseType } from './config-cache'
import { isInvestigableCaseType } from './case-type-slugs'

const DEFAULT_CLASSIFIER_TIMEOUT_MS = 14_000
const CLASSIFIER_TIMEOUT_MS = (() => {
  const raw = process.env.INTENT_CLASSIFY_TIMEOUT_MS
  const n = raw ? Number.parseInt(raw, 10) : NaN
  if (!Number.isFinite(n) || n < 3000) return DEFAULT_CLASSIFIER_TIMEOUT_MS
  return Math.min(n, 120_000)
})()

/** Keyword hints keyed by substrings of case `type` slug (deposit_issue → deposit). */
const TYPE_HINT_GROUPS: { slugIncludes: string; hints: string[] }[] = [
  {
    slugIncludes: 'deposit',
    hints: ['存款', '充值', '到账', '提现', '余额', '少到账', '差', 'deposit', 'transfer', 'payment', 'txn', 'top-up', 'top up'],
  },
  {
    slugIncludes: 'withdraw',
    hints: ['取款', '提现', 'withdraw', 'pending withdrawal'],
  },
  {
    slugIncludes: 'payment',
    hints: ['支付', '付款', '渠道', 'payment', 'paid', 'invoice'],
  },
  {
    slugIncludes: 'account',
    hints: ['账号', '登录', '冻结', '密码', '实名', 'account', 'login', 'locked'],
  },
  {
    slugIncludes: 'order',
    hints: ['订单', '下单', 'order', 'purchase'],
  },
]

function hintMatches(text: string, hint: string): boolean {
  const h = hint.toLowerCase().trim()
  return h.length > 0 && text.includes(h)
}

/** Deterministic-ish fallback when the LLM errors/times out or returns unusable JSON. */
export function heuristicFallbackClassification(
  message: string,
  caseTypes: CachedCaseType[],
): IntentClassification {
  const text = message.toLowerCase()
  if (caseTypes.length === 0) {
    return {
      intent: 'qa',
      matchedCaseTypes: [],
      needsClarification: false,
      reasoning: 'Heuristic: no enabled case types',
      extractedFacts: {},
    }
  }

  const scored = caseTypes
    .filter((ct) => isInvestigableCaseType(ct.type))
    .map((ct) => {
      let score = 0
      const slug = ct.type.toLowerCase()
      const slugParts = slug.split(/[^a-z0-9]+/).filter((s) => s.length > 2)
      for (const part of slugParts) {
        if (text.includes(part)) score += 3
      }

      const blob = `${ct.description || ''}\n${ct.defaultGoal || ''}`.toLowerCase()
      const blobWords = blob.split(/\s+/).filter((w) => w.length > 4)
      for (const w of blobWords) {
        if (text.includes(w)) score += 2
      }

      for (const fact of ct.requiredFacts) {
        const fl = fact.toLowerCase()
        if (fl.length > 2 && text.includes(fl)) score += 2
      }

      for (const group of TYPE_HINT_GROUPS) {
        if (!slug.includes(group.slugIncludes)) continue
        for (const h of group.hints) {
          if (hintMatches(text, h)) score += 4
        }
      }

      return { ct, score }
    })

  scored.sort((a, b) => b.score - a.score)
  const top = scored[0]

  if (!top || top.score < 5) {
    return {
      intent: 'qa',
      matchedCaseTypes: [],
      needsClarification: false,
      reasoning: 'Heuristic: no confident case-type match',
      extractedFacts: {},
    }
  }

  const threshold = Math.max(5, top.score * 0.52)
  let matchedCaseTypes: MatchedCaseType[] = scored
    .filter((s) => s.score >= threshold)
    .slice(0, 5)
    .map((s) => ({
      type: s.ct.type,
      displayName: s.ct.displayName,
      icon: s.ct.icon,
      confidence: Math.min(0.9, 0.42 + s.score / 28),
    }))

  matchedCaseTypes.sort((a, b) => b.confidence - a.confidence)

  const slugSet = new Map<string, MatchedCaseType>()
  for (const m of matchedCaseTypes) {
    const k = m.type.trim().toLowerCase()
    if (!slugSet.has(k)) slugSet.set(k, m)
  }
  matchedCaseTypes = [...slugSet.values()].sort((a, b) => b.confidence - a.confidence)

  const needsClarification = matchedCaseTypes.length > 1

  return {
    intent: 'case',
    matchedCaseTypes,
    needsClarification,
    reasoning: `Heuristic fallback (score ${top.score.toFixed(1)} → ${top.ct.type})`,
    extractedFacts: {},
  }
}

function buildClassificationPrompt(caseTypes: CachedCaseType[]): string {
  if (caseTypes.length === 0) {
    return `You are an intent classifier. No case types are currently available.
Classify the user's message. If it's casual chat (greeting, general question), use "qa".
If it's a specific issue but no matching types exist, use "qa".
Respond with JSON only.`
  }

  const typeList = caseTypes
    .map(
      (ct) =>
        `- "${ct.type}": ${ct.displayName} — ${ct.description || ct.defaultGoal}. Required facts: ${ct.requiredFacts.join(', ') || 'none'}`,
    )
    .join('\n')

  return `You are an intent classifier for a customer service system. Classify the user's message.

Available case types (only match if the user's issue clearly fits):
${typeList}

Respond with JSON only — no markdown, no explanation outside the JSON:
{
  "intent": "qa" | "case",
  "matchedCaseTypes": [{ "type": "type_slug", "displayName": "Human Name", "icon": "emoji", "confidence": 0.0-1.0 }],
  "reasoning": "one sentence explaining the classification",
  "extractedFacts": { "key": "value" }
}

Rules:
- "qa": casual chat, greeting, general question, or no issue to resolve. matchedCaseTypes must be [].
- "case": user describes issue(s) matching case types.
- **One primary issue fitting a single category** → matchedCaseTypes length **exactly 1** (pick the single best slug). Do NOT add secondary types unless the customer clearly bundled separate problems.
- **Clearly multiple unrelated issues each matching different slugs** → include each distinct slug once, sorted by confidence descending.
- Extract any IDs, amounts, dates, payment methods from the message into extractedFacts.
- Confidence >= 0.7 means a clear match for that row. Dedupe duplicate type slugs.`
}

export class IntentClassifier {
  private static parseResponse(text: string): IntentClassification {
    // Extract JSON from response (may be wrapped in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return {
        intent: 'qa',
        matchedCaseTypes: [],
        needsClarification: false,
        reasoning: 'Failed to parse classifier response',
        extractedFacts: {},
      }
    }

    try {
      const parsed = JSON.parse(jsonMatch[0])

      let matchedCaseTypes: MatchedCaseType[] = Array.isArray(parsed.matchedCaseTypes)
        ? parsed.matchedCaseTypes.map((m: Record<string, unknown>) => ({
            type: String(m.type || ''),
            displayName: String(m.displayName || m.type || ''),
            icon: String(m.icon || '📋'),
            confidence: typeof m.confidence === 'number' ? m.confidence : 0,
          }))
        : []

      matchedCaseTypes.sort((a, b) => b.confidence - a.confidence)

      const dedupByType = new Map<string, MatchedCaseType>()
      for (const m of matchedCaseTypes) {
        const slug = String(m.type || '').trim().toLowerCase()
        if (!slug) continue
        if (!dedupByType.has(slug)) dedupByType.set(slug, m)
      }
      matchedCaseTypes = [...dedupByType.values()].sort((a, b) => b.confidence - a.confidence)
      matchedCaseTypes = matchedCaseTypes.filter((m) => isInvestigableCaseType(m.type))

      const intent = parsed.intent === 'case' && matchedCaseTypes.length > 0 ? 'case' : 'qa'

      const needsClarification = intent === 'case' && matchedCaseTypes.length > 1

      return {
        intent: intent as 'qa' | 'case',
        matchedCaseTypes,
        needsClarification,
        reasoning: String(parsed.reasoning || ''),
        extractedFacts:
          parsed.extractedFacts && typeof parsed.extractedFacts === 'object'
            ? (parsed.extractedFacts as Record<string, string>)
            : {},
      }
    } catch {
      return {
        intent: 'qa',
        matchedCaseTypes: [],
        needsClarification: false,
        reasoning: 'Failed to parse classifier JSON',
        extractedFacts: {},
      }
    }
  }

  /** Load case types + model for classification. */
  private static async loadClassifyContext(customerId: string): Promise<{
    caseTypes: CachedCaseType[]
    model: string
  }> {
    let caseTypes = getCachedCaseTypes(customerId)
    if (!caseTypes) {
      const dbTypes = await prisma.caseType.findMany({
        where: { customerId, enabled: true },
        select: { type: true, displayName: true, description: true, icon: true, requiredFacts: true, defaultGoal: true },
      })
      caseTypes = dbTypes
        .map((ct) => ({
          type: ct.type, displayName: ct.displayName, description: ct.description,
          icon: ct.icon,
          requiredFacts: (() => { try { return JSON.parse(ct.requiredFacts) as string[] } catch { return [] } })(),
          defaultGoal: ct.defaultGoal,
        }))
        .filter((ct) => isInvestigableCaseType(ct.type))
      setCachedCaseTypes(customerId, caseTypes)
    }
    caseTypes = (caseTypes ?? []).filter((ct) => isInvestigableCaseType(ct.type))

    let model = process.env.INTENT_MODEL || 'MiniMax-M2.7-highspeed'
    try {
      const dbConfig = await prisma.agentConfig.findUnique({ where: { customerId } })
      if (dbConfig) {
        const intentModel = (dbConfig as any).intentModel as string | null
        if (intentModel) model = intentModel
        else if ((dbConfig as any).evaluationModel) model = (dbConfig as any).evaluationModel as string
      }
    } catch { /* use default model */ }

    return { caseTypes, model }
  }

  static async classify(
    message: string,
    customerId: string,
  ): Promise<IntentClassification & { modelUsed?: string }> {
    const { caseTypes, model } = await IntentClassifier.loadClassifyContext(customerId)

    const systemPrompt = buildClassificationPrompt(caseTypes)

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    })

    try {
      const response = await Promise.race([
        client.messages.create({
          model,
          max_tokens: 256,
          temperature: 0.1,
          system: systemPrompt,
          messages: [{ role: 'user', content: message }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Classification timed out')), CLASSIFIER_TIMEOUT_MS),
        ),
      ])

      const textContent = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as any).text)
        .join('')

      const parsed = IntentClassifier.parseResponse(textContent)

      const parsedBroken =
        parsed.matchedCaseTypes.length === 0 &&
        /\b(parse|failed)\b/i.test(parsed.reasoning || '')

      if (parsedBroken) {
        return { ...heuristicFallbackClassification(message, caseTypes), modelUsed: `${model} (heuristic)` }
      }

      return { ...parsed, modelUsed: model }
    } catch (err) {
      console.error('[IntentClassifier] Classification failed:', err)
      return { ...heuristicFallbackClassification(message, caseTypes), modelUsed: `${model} (heuristic fallback after error)` }
    }
  }
}
