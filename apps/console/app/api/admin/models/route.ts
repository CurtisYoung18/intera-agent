// GET /api/admin/models — Returns available models from configured providers
// Migrated to defineRoute (G1 contract seam).

import '@intera/shared/prisma' // side-effect: layered env loader (root .env + app .env.local)
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { buildModelList } from '@/lib/agent/build-model-list'

export const GET = defineRoute({
  method: 'GET',
  async handler() {
    const models = buildModelList()
    return apiOk({ models })
  },
})
