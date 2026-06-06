// One-time seed script to update renderHints for HTTP tools on a given agent config.
// Run: npx tsx packages/shared/prisma/seed-render-hints.ts [agentConfigId]

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const RENDER_HINTS: Record<string, string> = {
  get_account_status: '{"livechat":{"kind":"card","titleField":"$.status","buttons":[]},"web-chat":{"kind":"card","titleOverride":"Account Status"}}',
  get_kyc_status: '{"livechat":{"kind":"card","titleField":"$.kyc_status","subtitleField":"","buttons":[{"id":"kyc_help","postback":"kyc_help","labelStatic":"KYC Help","type":"message"}]},"web-chat":{"kind":"card","titleOverride":"KYC Status"}}',
  get_active_promotions: '{"livechat":{"kind":"carousel","itemsField":"$.data","idField":"$.promotion_id","itemTemplate":{"titleField":"$.title","subtitleField":"$.code","buttons":[{"id":"detail","postback":"promo_detail","labelStatic":"Details","type":"message"}]}},"web-chat":{"kind":"list","bulleted":false,"showIndex":true}}',
  get_withdraw_conditions: '{"livechat":{"kind":"carousel","itemsField":"$.data","idField":"$.started_at","itemTemplate":{"titleField":"$.condition_type","subtitleField":"$.status","buttons":[{"id":"check","postback":"check_condition","labelStatic":"Check","type":"message"}]}},"web-chat":{"kind":"list","bulleted":false,"showIndex":true}}',
  get_eligible_promotions: '{"livechat":{"kind":"carousel","itemsField":"$.data","idField":"$.promotion_id","itemTemplate":{"titleField":"$.title","subtitleField":"$.eligible_status","buttons":[{"id":"claim","postback":"claim_promo","labelStatic":"Claim","type":"message"}]}},"web-chat":{"kind":"list","bulleted":false,"showIndex":true}}',
  get_latest_withdrawal: '{"livechat":{"kind":"card","titleField":"$.status","subtitleField":"$.created_at","buttons":[{"id":"tx_history","postback":"tx_history","labelStatic":"Transaction History","type":"message"}]},"web-chat":{"kind":"card","titleOverride":"Latest Withdrawal"}}',
  get_latest_deposit: '{"livechat":{"kind":"card","titleField":"$.status","subtitleField":"$.created_at","buttons":[{"id":"tx_history","postback":"tx_history","labelStatic":"Transaction History","type":"message"}]},"web-chat":{"kind":"card","titleOverride":"Latest Deposit"}}',
  get_transaction_history: '{"livechat":{"kind":"carousel","itemsField":"$.data","idField":"$.order_id","itemTemplate":{"titleField":"$.amount","subtitleField":"$.status","buttons":[{"id":"detail","postback":"tx_detail","labelStatic":"Detail","type":"message"}]}},"web-chat":{"kind":"list","bulleted":false,"showIndex":true}}',
  get_recommended_games: '{"livechat":{"kind":"carousel","itemsField":"$.data","itemTemplate":{"titleField":"$.game_name","buttons":[{"id":"play","postback":"play_game","labelStatic":"Play","type":"message"}]}},"web-chat":{"kind":"list","bulleted":false,"showIndex":true}}',
  get_bet_history: '{"livechat":{"kind":"card","titleField":"$.data[0].total_bet_amount","subtitleField":"$.data[0].total_win_loss_amount","buttons":[{"id":"detail","postback":"bet_detail","labelStatic":"Details","type":"message"}]},"web-chat":{"kind":"card","titleOverride":"Bet History"}}',
}

async function main() {
  const agentConfigId = process.argv[2] || 'agent_default_v1'
  console.log(`Updating renderHints for agent: ${agentConfigId}`)

  for (const [name, renderHints] of Object.entries(RENDER_HINTS)) {
    try {
      const tool = await prisma.tool.findUnique({
        where: { agentConfigId_name: { agentConfigId, name } },
        select: { id: true, renderHints: true },
      })
      if (!tool) {
        console.log(`  SKIP ${name} — not found`)
        continue
      }
      await prisma.tool.update({
        where: { agentConfigId_name: { agentConfigId, name } },
        data: { renderHints },
      })
      console.log(`  OK   ${name}`)
    } catch (err) {
      console.error(`  FAIL ${name}:`, String(err).slice(0, 100))
    }
  }

  console.log('Done.')
  await prisma.$disconnect()
}

main()
