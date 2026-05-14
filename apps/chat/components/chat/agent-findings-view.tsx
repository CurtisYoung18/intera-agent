'use client'

interface AgentFindingsViewProps {
  findings?: Record<string, unknown>
  recommendation?: string
}

export default function AgentFindingsView({ findings, recommendation }: AgentFindingsViewProps) {
  const hasFindings = findings && Object.keys(findings).length > 0

  if (!hasFindings && !recommendation) {
    return (
      <p className="text-[11px] text-fog/40 mt-2">No findings recorded.</p>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      {/* Recommendation */}
      {recommendation && (
        <div className="bg-emerald/[0.06] border border-emerald/10 rounded-md px-2.5 py-1.5">
          <p className="text-[10px] text-fog/50 uppercase tracking-wider mb-0.5">Recommendation</p>
          <p className="text-[11px] text-emerald/90 leading-snug">{recommendation}</p>
        </div>
      )}

      {/* Facts */}
      {hasFindings && (
        <div className="space-y-1">
          <p className="text-[10px] text-fog/50 uppercase tracking-wider">Findings</p>
          {Object.entries(findings!).map(([key, value]) => {
            const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
            // Skip error keys and internal fields
            if (key === 'error' || key === 'ok') return null
            return (
              <div key={key} className="flex items-start gap-1.5 text-[11px]">
                <span className="text-fog/40 flex-shrink-0 font-mono">{key}:</span>
                <span className="text-fog/80 truncate">{displayValue}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
