import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function OpsCaseDetailRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { caseId } = await params
  return redirectWithSearch(`/operate/conversations/cases/${encodeURIComponent(caseId)}`, searchParams)
}
