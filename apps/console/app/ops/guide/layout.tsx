import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'How Intera runs · Console Guide',
  description:
    'How Intera runs: surfaces, Agent loop, Procedure runs, memory, streaming tools, human tasks, hooks, and where to find the code.',
}

export default function OpsGuideLayout({ children }: { children: React.ReactNode }) {
  return children
}
