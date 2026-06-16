import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function BuildPlaygroundPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectWithSearch('/build/pilot-lab?tab=playground', searchParams)
}
