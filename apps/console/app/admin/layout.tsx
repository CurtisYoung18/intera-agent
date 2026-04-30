// Admin layout — pass-through wrapper (chrome is in root layout via ConsoleShell)

import type { ReactNode } from 'react'

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
