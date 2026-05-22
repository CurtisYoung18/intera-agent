import { PrismaClient } from '@prisma/client'
async function main() {
  const p = new PrismaClient()
  const rows = await p.caseType.findMany({
    where: { customerId: 'default' },
    select: { type: true, executionMode: true, sop: true },
  })
  for (const r of rows) {
    console.log(`${r.type.padEnd(22)} | mode: ${r.executionMode.padEnd(6)} | sop: ${r.sop?.length ?? 0} chars`)
  }
  await p.$disconnect()
}
main().catch(console.error)
