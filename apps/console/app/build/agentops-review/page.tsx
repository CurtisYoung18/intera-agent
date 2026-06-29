import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function AgentOpsReviewPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectWithSearch('/build/pilot-lab?tab=pilot', searchParams)
}
