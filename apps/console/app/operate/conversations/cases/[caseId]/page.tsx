import { redirect } from 'next/navigation'

export default async function OperateCaseConversationRedirect({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  redirect(`/operate/conversations/${encodeURIComponent(caseId)}`)
}
