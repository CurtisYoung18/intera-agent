/**
 * seed-sop.ts — Writes SOP documents for all default case types.
 *
 * Run with:
 *   npx tsx scripts/seed-sop.ts
 *
 * Safe to re-run — only updates the `sop` field; leaves stages/policies untouched.
 * To switch a case to SOP mode in the UI, toggle "Execution Mode" on the console
 * and compare agent behaviour with stage mode.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const VENDOR_ID = 'default'

// ─── SOP documents ───────────────────────────────────────────────────────────

const SOP_BY_TYPE: Record<string, string> = {

  // ──────────────────────────────────────────────────────────────────────
  deposit_issue: `
# 存款未到账 — 处理 SOP

## 目标
核实订单与支付渠道状态，判断延迟、失败或需补单；系统与客户说法冲突时升级人工核查。

## 步骤

1. **开场安抚**
   - 简短确认收到客户反馈，表示正在处理。

2. **收集关键信息** ← 如已知 txnId + amount + paymentMethod 则跳至步骤 3
   - 调用 request_user_input 一次性收集：
     - txnId（交易流水号）
     - amount（充值金额）
     - paymentMethod（支付方式：Alipay / WeChat Pay / USDT / 银行卡等）
     - date（充值时间，选填）
   - 不要在文字中列出问题——直接弹表单。

3. **并行调查**（同一轮调用，不分两步）
   - query_order_status(txnId=confirmedFacts.txnId)
   - query_payment_channel_status(txnId=confirmedFacts.txnId)
   - ⚠️ txnId 必须来自 confirmedFacts，不能用子代理 findings 中的参考 txnId。

4. **判断结果**
   - 订单未找到 / txnId 不匹配 → 直接 create_human_task(queue="payment_ops")，说明订单查无此号
   - 订单已完成但客户未收到（金额/渠道/状态冲突）→ create_human_task(queue="payment_ops")
   - delayed_batch=true → 告知批结算预计到账时间（通常 30 分钟~2 小时），进入步骤 6
   - 订单 pending + 渠道正常 → 告知正在处理，若超时可联系人工
   - 数据一致无冲突 → 进入步骤 6

5. **补充调查**（按需，非必须）
   - search_delay_notice：查是否有已公告的渠道维护或延迟
   - read_case_history：查客户历史工单，看是否重复发生
   - kb_hybrid_retrieve：查知识库，如有适用条款引用
   - 需要客户补充截图等 → request_user_input，不要纯文字追问

6. **结案**
   - finalize_case，conclusion 须引用具体证据（订单状态、渠道状态、公告等）
   - 用友好语气向客户说明结论与下一步
`.trim(),

  // ──────────────────────────────────────────────────────────────────────
  order_issue: `
# 订单问题 — 处理 SOP

## 目标
确认订单状态并向客户解释，冲突时升级人工。

## 步骤

1. **收集信息** ← 如已知 orderId + issueType 则跳至步骤 2
   - request_user_input 一次收集：
     - orderId（订单号）
     - issueType（问题类型：未到账 / 状态异常 / 重复扣款等）

2. **核实订单**
   - query_order_status(txnId=orderId)
   - 同时调用 query_payment_channel_status 核查渠道

3. **判断结果**
   - 订单正常、与客户描述一致 → 进入步骤 5
   - 有冲突（已完成但客户未收到、金额不符等）→ create_human_task(queue="payment_ops")
   - 订单 pending + 渠道延迟 → 告知预计到账时间
   - 需要更多信息 → request_user_input

4. **补充调查**（按需）
   - search_delay_notice：查平台公告
   - read_case_history：查历史工单
   - kb_hybrid_retrieve：查知识库

5. **结案**
   - finalize_case，引用订单查询结果与渠道状态作为证据
`.trim(),

  // ──────────────────────────────────────────────────────────────────────
  account_issue: `
# 账号问题 — 处理 SOP

## 目标
拉取账号状态记录，判断限制/封禁/误拦原因；冲突或高风险场景升级账号运营人工复核。

## 步骤

1. **收集信息** ← 如已知 userId + issueType 则跳至步骤 2
   - request_user_input 一次收集：
     - userId（平台 UID）
     - issueType（登录失败 / 封号 / 风控提示 / 疑似盗号 / 验证异常）
     - symptoms（报错码、页面提示、起始时间，选填）

2. **并行账号核查**（同一轮，两项必须同时调用）
   - get_account_status(member_id=confirmedFacts.userId)
   - get_kyc_status(member_id=confirmedFacts.userId)

3. **查历史与知识库**
   - read_case_history：查客户历史工单，判断是否复发
   - kb_hybrid_retrieve：查封禁条款、申诉流程、已知故障记录

4. **判断结果**
   - 账号状态与客户描述冲突（系统显示正常但客户无法登录）→ create_human_task(queue="account_ops")
   - KYC 未完成导致限制 → 告知 KYC 流程并引导完成
   - KB 指明需要人工申诉 → create_human_task(queue="account_ops")
   - 账号已封禁且原因明确（违规等）→ 告知原因，按政策说明申诉路径
   - 数据支持自动解决 → 进入步骤 5

5. **结案**
   - finalize_case，引用账号状态、KYC 状态、历史记录或 KB 条款作为证据
`.trim(),

  // ──────────────────────────────────────────────────────────────────────
  refund_request: `
# 退款申请 — 处理 SOP

## 目标
核查退款资格，合规退款走人工审批；不符合政策的清晰说明原因结案。

## 步骤

1. **收集信息** ← 如已知 orderId + amount + reason 则跳至步骤 2
   - request_user_input 一次收集：
     - orderId（订单号）
     - amount（退款金额）
     - reason（申请原因）

2. **核实订单**
   - query_order_status(txnId=orderId)
   - 确认订单存在、金额匹配、状态可退款

3. **政策核查**
   - kb_hybrid_retrieve 查退款政策，确认是否符合退款条件
   - 如有必要 read_case_history 查客户历史申请记录

4. **判断结果**
   - 金额大（超平台限额）或政策限制 → create_human_task(queue="payment_ops")，说明需人工审批
   - 符合政策且金额合理 → create_human_task(queue="payment_ops")，注明已核实可退
     ⚠️ 本案型要求人工审批（requireHumanReview=true），禁止直接承诺退款
   - 不符合退款条件 → 向客户解释原因，引用具体政策条款，进入步骤 5

5. **结案**
   - finalize_case，引用订单查询与政策条款
`.trim(),

  // ──────────────────────────────────────────────────────────────────────
  withdrawal_issue: `
# 提现问题 — 处理 SOP

## 目标
查询取款状态与打码量条件，判断延迟、不足或被拒原因；数据矛盾时升级人工。

## 步骤

1. **收集信息** ← 如已知 member_id + issueType 则跳至步骤 2
   - request_user_input 一次收集：
     - member_id（平台用户 ID）
     - issueType（未到账 / 打码量不足 / 被拒等）
     - amount（提现金额，选填）

2. **并行调查**（同一轮，两项必须同时调用）
   - get_latest_withdrawal(member_id=confirmedFacts.member_id)
   - get_withdraw_conditions(member_id=confirmedFacts.member_id)

3. **深度查询**（按需）
   - get_transaction_history：看近期出入金记录
   - read_case_history：查历史提现工单
   - kb_hybrid_retrieve：查提现政策与打码量规则

4. **判断结果**
   - 取款状态与客户描述冲突（系统显示已到但客户未收到）→ create_human_task(queue="withdrawal_ops")
   - 打码量不足 → 告知具体缺口（例：还差 XX 流水），说明如何满足条件
   - 取款 pending + 等待银行处理 → 告知预计到账时间（通常 1~3 个工作日）
   - 被拒且原因明确 → 告知原因（不符合提现条件/风控等）并说明申诉路径

5. **结案**
   - finalize_case，引用取款状态与打码量数据
`.trim(),

  // ──────────────────────────────────────────────────────────────────────
  promotion_inquiry: `
# 优惠咨询 — 处理 SOP

## 目标
查询用户优惠状态与参与条件，一次性提供完整信息。

## 步骤

1. **确认 member_id**
   - 从 confirmedFacts 获取 member_id；如无则 request_user_input 收集。

2. **并行查询**（同一轮，两项同时调用）
   - get_active_promotions(member_id=confirmedFacts.member_id)
   - get_eligible_promotions(member_id=confirmedFacts.member_id)

3. **打码量条件**（客户询问提现流水时调用）
   - get_withdraw_conditions(member_id=confirmedFacts.member_id)

4. **整合信息回复**
   - 当前参与的优惠活动
   - 可参与但尚未参与的活动
   - 相关提现/流水要求
   - 如有疑问引用 kb_hybrid_retrieve 查政策

5. **结案**
   - 客户问题已回答 → finalize_case，引用优惠查询结果
   - 优惠数据与客户预期不符 → create_human_task(queue="general")
`.trim(),

}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('📋 Seeding SOP documents for all case types...\n')

  for (const [caseType, sop] of Object.entries(SOP_BY_TYPE)) {
    const existing = await prisma.caseType.findUnique({
      where: { vendorId_type: { vendorId: VENDOR_ID, type: caseType } },
    })

    if (!existing) {
      console.log(`  ⚠️  ${caseType}: not found in DB, skipping (run the app once to seed defaults)`)
      continue
    }

    await prisma.caseType.update({
      where: { vendorId_type: { vendorId: VENDOR_ID, type: caseType } },
      data: { sop },
    })

    console.log(`  ✓  ${caseType}: SOP written (${sop.length} chars)`)
  }

  console.log('\nDone. Reload the console and toggle "SOP Mode" on any case type to compare.')
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
