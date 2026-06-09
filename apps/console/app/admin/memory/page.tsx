import { redirect } from 'next/navigation'

export default function LegacyMemoryPage() {
  redirect('/build/components/brain?mode=memory')
}
