import { defineRoute } from '@/lib/api/define-route'
import { buildChatForensicPack } from '@/lib/agentops/forensic-pack'
import { apiOk } from '@intera/shared/contracts/envelope'
import { forensicPackQuerySchema, type ForensicPackQuery } from '@intera/shared/contracts/agentops/forensic-pack'

type Params = {
  agentId: string
  chatId: string
}

export const GET = defineRoute<ForensicPackQuery, Params>({
  method: 'GET',
  parseQuery: true,
  inputSchema: forensicPackQuerySchema,
  scope: 'agent',
  async handler({ input, params, repo }) {
    const agentId = decodeURIComponent(params.agentId)
    const chatId = decodeURIComponent(params.chatId)
    const pack = await buildChatForensicPack({
      repo,
      agentId,
      chatId,
      translate: input.translate,
    })

    return apiOk(pack)
  },
})
