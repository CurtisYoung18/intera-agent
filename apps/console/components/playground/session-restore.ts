export interface RestoredPlaygroundTrace {
  id: string
  actionType: string
  title: string
  detail: string
  payload: string
  createdAt: string
}

function isTurnStartTrace(trace: RestoredPlaygroundTrace): boolean {
  return trace.actionType === 'user_message'
    || (trace.actionType === 'agent_tree_node' && /run start$/i.test(trace.title || ''))
}

export function groupRestoredTracesByTurn(
  traces: RestoredPlaygroundTrace[],
): RestoredPlaygroundTrace[][] {
  if (traces.length === 0) return []

  const groups: RestoredPlaygroundTrace[][] = []
  let currentGroup: RestoredPlaygroundTrace[] = []

  for (const trace of traces) {
    const startsTurn = isTurnStartTrace(trace)
    const currentGroupHasNonStartTrace = currentGroup.some((entry) => !isTurnStartTrace(entry))

    if (startsTurn && currentGroup.length > 0 && currentGroupHasNonStartTrace) {
      groups.push(currentGroup)
      currentGroup = []
    }

    currentGroup.push(trace)
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups
}
