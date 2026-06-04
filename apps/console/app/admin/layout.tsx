// Admin layout — wraps children with AgentProvider for reactive agent selection state

import type { ReactNode } from 'react'
import { AgentProvider } from '@/lib/agent/agent-context'

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AgentProvider>{children}</AgentProvider>
}
