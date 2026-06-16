import { redirect } from 'next/navigation'

type SearchParamsValue = string | string[] | undefined
type SearchParamsRecord = Record<string, SearchParamsValue>

export async function redirectWithSearch(
  pathname: string,
  searchParams?: Promise<SearchParamsRecord> | SearchParamsRecord,
): Promise<never> {
  const resolved = searchParams ? await searchParams : {}
  const [targetPath, targetQuery = ''] = pathname.split('?', 2)
  const query = new URLSearchParams(targetQuery)

  for (const [key, value] of Object.entries(resolved)) {
    if (query.has(key)) continue
    if (typeof value === 'string') {
      query.set(key, value)
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item)
    }
  }

  const queryString = query.toString()
  return redirect(queryString ? `${targetPath}?${queryString}` : targetPath)
}
