import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function AdminScenariosRedirect({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectWithSearch('/build/pilot-lab', searchParams)
}
