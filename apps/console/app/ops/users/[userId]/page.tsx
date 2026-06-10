import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function OpsUserDetailRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { userId } = await params
  return redirectWithSearch(`/operate/handoff/${encodeURIComponent(userId)}`, searchParams)
}
