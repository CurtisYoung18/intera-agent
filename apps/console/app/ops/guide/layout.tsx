import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'How Intera runs · Console Guide',
  description:
    'How Intera runs: surfaces, Agent loop, Case memory & stages, streaming tools, human tasks, and where to find the code.',
}

export default function OpsGuideLayout({ children }: { children: React.ReactNode }) {
  return children
}
