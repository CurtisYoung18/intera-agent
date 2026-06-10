import { redirect } from 'next/navigation'

type SearchParamsValue = string | string[] | undefined
type SearchParamsRecord = Record<string, SearchParamsValue>

export async function redirectWithSearch(
  pathname: string,
  searchParams?: Promise<SearchParamsRecord> | SearchParamsRecord,
): Promise<never> {
  const resolved = searchParams ? await searchParams : {}
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string') {
      query.set(key, value)
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item)
    }
  }

  const queryString = query.toString()
  return redirect(queryString ? `${pathname}?${queryString}` : pathname)
}
