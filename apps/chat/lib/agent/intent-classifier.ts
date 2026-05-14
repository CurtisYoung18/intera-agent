// Intera Harness - Intent Classifier
// Lightweight LLM call that maps a user message to either "qa" (casual chat)
// or "case" with matched Case Types. Called before the main AgentLoop.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@intera/shared/prisma'
import type { IntentClassification, MatchedCaseType } from '@intera/shared/types'
import { getCachedCaseTypes, setCachedCaseTypes, type CachedCaseType } from './config-cache'

const CLASSIFIER_TIMEOUT_MS = 2_000

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
- "case": user describes a specific issue matching at least one case type. Include ALL matching types sorted by confidence descending.
- Extract any IDs, amounts, dates, payment methods from the message into extractedFacts.
- If multiple case types match, include ALL of them with individual confidence scores.
- Confidence >= 0.7 means a clear match. Lower means uncertain.`
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

      const matchedCaseTypes: MatchedCaseType[] = Array.isArray(parsed.matchedCaseTypes)
        ? parsed.matchedCaseTypes.map((m: Record<string, unknown>) => ({
            type: String(m.type || ''),
            displayName: String(m.displayName || m.type || ''),
            icon: String(m.icon || '📋'),
            confidence: typeof m.confidence === 'number' ? m.confidence : 0,
          }))
        : []

      const topConfidence = matchedCaseTypes[0]?.confidence ?? 0
      const secondConfidence = matchedCaseTypes[1]?.confidence ?? 0
      const intent = parsed.intent === 'case' && matchedCaseTypes.length > 0 ? 'case' : 'qa'

      // Smart clarification: if top confidence is high and clearly beats the runner-up, auto-create.
      // Otherwise, flag that the Core Agent should ask the user to clarify.
      const needsClarification = intent === 'case' && !(topConfidence > 0.8 && topConfidence - secondConfidence > 0.3)

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

  static async classify(
    message: string,
    customerId: string,
  ): Promise<IntentClassification> {
    // Load enabled case types (with cache)
    let caseTypes = getCachedCaseTypes(customerId)
    if (!caseTypes) {
      try {
        const dbTypes = await prisma.caseType.findMany({
          where: { customerId, enabled: true },
          select: {
            type: true,
            displayName: true,
            description: true,
            icon: true,
            requiredFacts: true,
            defaultGoal: true,
          },
        })
        caseTypes = dbTypes.map((ct) => ({
          type: ct.type,
          displayName: ct.displayName,
          description: ct.description,
          icon: ct.icon,
          requiredFacts: (() => {
            try { return JSON.parse(ct.requiredFacts) as string[] } catch { return [] }
          })(),
          defaultGoal: ct.defaultGoal,
        }))
        setCachedCaseTypes(customerId, caseTypes)
      } catch (err) {
        console.error('[IntentClassifier] Failed to load case types:', err)
        return {
          intent: 'qa',
          matchedCaseTypes: [],
          needsClarification: false,
          reasoning: 'DB error loading case types',
          extractedFacts: {},
        }
      }
    }

    // Load agent config for the classification model
    let model = process.env.INTENT_MODEL || 'claude-haiku-4-5-20251001'
    try {
      const dbConfig = await prisma.agentConfig.findUnique({ where: { customerId } })
      if (dbConfig) {
        const intentModel = (dbConfig as any).intentModel as string | null
        if (intentModel) model = intentModel
        else if ((dbConfig as any).evaluationModel) model = (dbConfig as any).evaluationModel as string
      }
    } catch { /* use default model */ }

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

      return IntentClassifier.parseResponse(textContent)
    } catch (err) {
      console.error('[IntentClassifier] Classification failed:', err)
      return {
        intent: 'qa',
        matchedCaseTypes: [],
        needsClarification: false,
        reasoning: `Classification error: ${err instanceof Error ? err.message : 'unknown'}`,
        extractedFacts: {},
      }
    }
  }
}
