import { Prisma } from '@prisma/client'
import type { SegmentMessageInput } from './conversation-segments'

type SegmentMessageActivityRow = {
  id: string
  caseId: string
  role: string | null
  createdAt: Date
  isInternal: boolean
}

type SegmentMessageActivityRepo = {
  orgId: string
  raw: {
    $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T>
  }
}

const CASE_ID_CHUNK_SIZE = 1000

function chunkStrings(values: string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

export async function loadSegmentMessageActivityByCaseId(
  repo: SegmentMessageActivityRepo,
  caseIds: string[],
): Promise<Map<string, SegmentMessageInput[]>> {
  const uniqueCaseIds = [...new Set(caseIds.filter(Boolean))]
  const byCaseId = new Map<string, SegmentMessageInput[]>()
  if (uniqueCaseIds.length === 0) return byCaseId

  for (const chunk of chunkStrings(uniqueCaseIds, CASE_ID_CHUNK_SIZE)) {
    const rows = await repo.raw.$queryRaw<SegmentMessageActivityRow[]>(Prisma.sql`
      SELECT
        m.id,
        m."caseId",
        m.role,
        m."createdAt",
        (
          coalesce(m."providerMeta"->>'visibility', '') = 'internal'
          OR coalesce(m."providerMeta"->>'transcriptKind', '') = 'tool_result'
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(coalesce(m."providerContent", '[]'::jsonb)) AS provider_block
            WHERE provider_block->>'type' = 'tool_result'
          )
        ) AS "isInternal"
      FROM "messages" AS m
      WHERE m."org_id" = ${repo.orgId}
        AND m."caseId" IN (${Prisma.join(chunk)})
      ORDER BY m."createdAt" ASC
    `)

    for (const row of rows) {
      const bucket = byCaseId.get(row.caseId) ?? []
      bucket.push({
        id: row.id,
        caseId: row.caseId,
        role: row.role,
        createdAt: row.createdAt,
        isInternal: Boolean(row.isInternal),
      })
      byCaseId.set(row.caseId, bucket)
    }
  }

  return byCaseId
}

export function attachSegmentMessageActivity<TCase extends { id: string }>(
  cases: TCase[],
  messagesByCaseId: Map<string, SegmentMessageInput[]>,
): Array<TCase & { messages: SegmentMessageInput[] }> {
  return cases.map((caseRow) => ({
    ...caseRow,
    messages: messagesByCaseId.get(caseRow.id) ?? [],
  }))
}
