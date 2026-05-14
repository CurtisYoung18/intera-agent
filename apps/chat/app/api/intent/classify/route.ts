// Intera Harness - Intent Classification API
// POST /api/intent/classify — Lightweight pre-classification endpoint.
// Called by the frontend BEFORE the main /api/messages call so the UI
// can show the split animation immediately.

import { NextRequest, NextResponse } from 'next/server'
import { IntentClassifier } from '@/lib/agent/intent-classifier'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, customerId } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'message is required' },
        { status: 400 },
      )
    }

    const resolvedCustomerId = customerId || 'default'
    const classification = await IntentClassifier.classify(message, resolvedCustomerId)

    return NextResponse.json(classification)
  } catch (err) {
    console.error('[Intent Classify API] Error:', err)
    return NextResponse.json(
      {
        intent: 'qa',
        matchedCaseTypes: [],
        needsClarification: false,
        reasoning: `API error: ${err instanceof Error ? err.message : 'unknown'}`,
        extractedFacts: {},
      },
    )
  }
}
