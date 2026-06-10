import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function AdminCaseTypeDetailRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { name } = await params
  return redirectWithSearch(`/build/components/procedures/${encodeURIComponent(name)}`, searchParams)
}
