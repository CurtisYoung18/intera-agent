#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ADMIN_ROOT = path.join(process.cwd(), 'apps/console/app/api/admin')
const RISK_PATTERN = /\brepo\.raw\b|\bprisma\./
const DEFINE_ROUTE_PATTERN = /defineRoute(?:<[\s\S]*?>)?\s*\(\s*\{/g
const AGENT_SCOPE_PATTERN = /\bscope\s*:\s*['"]agent['"]/

const REVIEWED_ALLOWLIST = new Map([
  [
    'apps/console/app/api/admin/agent-configs/[id]/activate/route.ts',
    'AgentConfig activation remains org-scoped with explicit repo.orgId filters inside the transaction.',
  ],
  [
    'apps/console/app/api/admin/agent-configs/[id]/fork/route.ts',
    'AgentConfig fork operates on org-owned agent configs and copies sub-modules after org-scoped source resolution.',
  ],
  [
    'apps/console/app/api/admin/agent-configs/[id]/route.ts',
    'AgentConfig item route is the org-scoped parent resource, not an agent sub-module route.',
  ],
  [
    'apps/console/app/api/admin/agent-configs/route.ts',
    'AgentConfig collection route is the org-scoped parent resource and uses orgId-owned config discovery.',
  ],
  [
    'apps/console/app/api/admin/agent/route.ts',
    'Legacy active-agent route still supports no-id org-default behavior; existing optional agentId assertions are preserved.',
  ],
  [
    'apps/console/app/api/admin/customers/route.ts',
    'Customer org bootstrap/list route is org-scoped and does not accept an agentConfigId boundary.',
  ],
  [
    'apps/console/app/api/admin/hooks/_helpers.ts',
    'Helper-only module used by agent-scoped Hook routes; no defineRoute entry point exists here.',
  ],
  [
    'apps/console/app/api/admin/invitations/route.ts',
    'Invitation/member checks are org-scoped membership operations, not agent sub-module access.',
  ],
  [
    'apps/console/app/api/admin/knowledge/gptbots/route.ts',
    'GPTBots GET intentionally supports optional no-agent fallback; existing PUT/manual assertion remains route-local.',
  ],
  [
    'apps/console/app/api/admin/organizations/[id]/route.ts',
    'Organization admin route is org-scoped and does not accept an agentConfigId boundary.',
  ],
  [
    'apps/console/app/api/admin/pilot/validation/propose-fix/route.ts',
    'Pilot validation fix route combines org-scoped PilotSession rows with an existing explicit agent ownership assertion.',
  ],
  [
    'apps/console/app/api/admin/playground/save-to-chat/route.ts',
    'Playground export writes org-owned synthetic conversation evidence and is not an agent sub-module CRUD route.',
  ],
  [
    'apps/console/app/api/admin/playground/sessions/[chatId]/route.ts',
    'Playground session detail/delete is scoped by org-owned Case/Chat identifiers rather than agentConfigId.',
  ],
  [
    'apps/console/app/api/admin/playground/sessions/route.ts',
    'Playground session listing is scoped by org-owned Case rows rather than agentConfigId.',
  ],
])

const files = await listTsFiles(ADMIN_ROOT)
const riskyFiles = []

for (const file of files) {
  if (file.includes(`${path.sep}__tests__${path.sep}`)) continue
  const source = await readFile(file, 'utf8')
  if (!RISK_PATTERN.test(source)) continue
  riskyFiles.push(file)
}

const failures = []

for (const file of riskyFiles) {
  const relative = toRepoRelative(file)
  if (REVIEWED_ALLOWLIST.has(relative)) continue

  const source = await readFile(file, 'utf8')
  const segments = defineRouteSegments(source)
  const hasEveryRouteScoped = segments.length > 0 && segments.every((segment) => AGENT_SCOPE_PATTERN.test(segment))
  if (!hasEveryRouteScoped) {
    failures.push(`${relative} contains repo.raw/prisma access without scope: 'agent' on every defineRoute call`)
  }
}

for (const [relative, reason] of REVIEWED_ALLOWLIST) {
  const file = path.join(process.cwd(), relative)
  if (!riskyFiles.includes(file)) {
    failures.push(`${relative} is in the reviewed isolation allowlist but no longer contains repo.raw/prisma access; remove the stale allowlist entry (${reason})`)
  }
}

if (failures.length > 0) {
  console.error('Isolation seam guard failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Isolation seam guard passed: ${riskyFiles.length} raw-access admin files checked, ${REVIEWED_ALLOWLIST.size} reviewed allowlist entries.`)

async function listTsFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      results.push(...await listTsFiles(fullPath))
    } else if (entry.isFile() && fullPath.endsWith('.ts')) {
      results.push(fullPath)
    }
  }
  return results
}

function defineRouteSegments(source) {
  const matches = [...source.matchAll(DEFINE_ROUTE_PATTERN)]
  return matches.map((match, index) => {
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? source.length
    return source.slice(start, end)
  })
}

function toRepoRelative(file) {
  return path.relative(process.cwd(), file).split(path.sep).join('/')
}
