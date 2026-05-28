# LiveChat 接管 ② — 让只有 Intera 响应（多 app 独占 + 路由）

> 作者：代码审计 2026-05-28（已按 **Agent 账号接管模型** 修订，见文档①§0.0）
> 目标读者：开发 + 运维/账号管理员
> 前置：你对 license 18578946 有管理员权限，**能禁用但不能删除**其它 app。采用 GPTBots 式「人工 agent 账号被 AI 接管」模型。
> 解决问题：widget 发一条消息，多个 app/agent 背后的 AI 同时响应。

---

## 0. 为什么会"多个 AI 抢答"（Agent 接管模型下）

两个叠加的成因：

**成因一：webhook 广播。** LiveChat 的 webhook 按 app（Client ID）订阅、按 license 启用。同一 license 装了 N 个会发消息的 app/集成，**每个都收到 `incoming_event`**。

**成因二：Intera 不判断会话归属。** 即便只有 Intera 一个集成，它现在对每个 `incoming_event` 都无脑响应（不读 `chat_presence_user_ids`、不看会话分给了谁）。多集成时，每家都这么干 → 一起说话。

```
访客消息
   │  LiveChat 路由把会话分给某个 Primary agent；但 webhook 仍广播给所有订阅方
   ├─────────────▶ App A（接管 agent A）→ 不判断归属，回一条
   ├─────────────▶ App B（接管 agent B）→ 不判断归属，回一条
   └─────────────▶ Intera（接管 agent X）→ 不判断归属，回一条
                 = 三个 AI 同时说话
```

**关键事实**：
- 你**无法从代码里阻止别的 app 收到 webhook**（订阅在各自 Client ID 下）→ 这部分靠**平台侧禁用 + 路由独占**（§1）。
- 但你**能从代码里让 Intera 只回"分给自己那个 agent"的会话** → 这才是多 AI 抢答的**代码侧解药**（§2，即文档①修复 F 的在场过滤）。
- 两者叠加才稳：**路由保证会话只分给 Intera 的 agent；在场过滤保证 Intera 只回自己被分到的会话。**

---

## 1. 平台侧配置（根治，优先做）

> 你说"能禁用不能删除"——没关系，**禁用就够了**。下面按"从最干净到最兜底"排列，**做到第 1 步通常就解决了**。

### 1.1 盘点：这个 license 上到底有谁在抢

先搞清楚现状，别盲目关。

**A. 看已安装的集成 / app**
LiveChat Agent App → **Settings → Integrations / Apps**（或 Marketplace → Installed）。列出所有"会发消息"的 app（chatbot、AI agent、自动回复类）。

**B. 看 webhook 订阅**
对你能进的每个 app，去 **Developer Console → 该 app → Building blocks → Webhooks**，看谁订阅了 `incoming_event` / `incoming_chat`。

**C. 看自带 ChatBot**
Agent App → **ChatBot**（LiveChat 自家产品）是否启用了自动回复 story。

**D. 看 Agents 列表里的 bot**
Agent App → **Team / Agents**，看有几个 `bot` 类型 agent、各自 routing 状态。

> 用 API 盘点（只读）：
> ```bash
> curl -s -X POST https://api.livechatinc.com/v3.5/agent/action/list_agents \
>   -H "Authorization: <Bearer|Basic> <token>" -H "X-Region: <dal|fra>" \
>   -H "Content-Type: application/json" -d '{}'
> ```

### 1.2 第 1 步（最干净）：只留 Intera 的 webhook，禁用其它

对每个**非 Intera** 的 chatbot app：

- Developer Console → 该 app → Webhooks → 把 `incoming_event` / `incoming_chat` 订阅 **Disable**（不用删）。
- 或在 Agent App → Integrations 里把该 app **Disable / 停用**。

把 LiveChat 自带 ChatBot 的自动 story **关掉 / 设为不自动接管**。

→ 结果：只剩 Intera 收到 `incoming_event`，只有 Intera 回。

### 1.3 第 2 步（推荐叠加）：用 Group + Primary/Backup + accepting_chats 做路由独占

这是 Agent 接管模型的**正统路由**做法（GPTBots 文档同款）：

**做法**：
1. Agent App → **Team → Group**，建一个 Group。
2. 把**被 Intera 接管的 agent 账号**加入并设为 **Primary**（主接单）。
3. 把**人工客服账号**加入并设为 **Backup**（兜底/人工接管）。
4. 让 Intera 的 agent **`accepting_chats`（在线接单）**，其它非必要 agent 设 `not_accepting_chats`。
5. 确认 **Routing rules** 把新会话指向这个 Group（别被默认规则路由到别处）。

设置 agent routing 状态（Agent Chat API，PAT Basic）：
```bash
curl -s -X POST https://api.livechatinc.com/v3.5/agent/action/set_routing_status \
  -H "Authorization: Basic <base64(accountId:token)>" -H "X-Region: <dal|fra>" \
  -H "Content-Type: application/json" \
  -d '{"status":"accepting_chats","agent_id":"<intera_agent_email_or_id>"}'
```

> 结果：新会话只路由分给 Intera 的 Primary agent；人工只在 Intera 让位时作为 Backup 接手。配合 §2 的在场过滤，即使别家 webhook 还在响也只有"被分到会话"的那个会真正回。

### 1.4 第 3 步（确认）：再发一条测试消息

只剩一个回复 = 成功。若仍多条，回 1.1 看是不是漏了某个 app / 自带 ChatBot。

---

## 2. 代码侧守卫（本模型的主解药，不是可选兜底）

代码侧管不了别家 app **收**不收 webhook，但能让 Intera **只回"分给自己那个 agent"的会话**——这在多集成场景下就是"只有一个 AI 说话"的根本保证。

### 2.0 在场过滤（**最重要**，= 文档 ① 修复 F）

按 `chat_presence_user_ids` 判断：**只在被接管 agent 在场（= 会话分给了我）时才响应**。这一条同时解决"多 AI 抢答"和"对没分到的会话硬发导致 403"。详细代码见[文档①修复 F](2026-05-28-livechat-01-根因审计与打通文字消息.md)。要点：

```ts
const presentIds = (body.additional_data?.chat_presence_user_ids
  ?? body.payload?.chat_presence_user_ids ?? []) as string[]
if (config.agentAccountId && presentIds.length && !presentIds.includes(config.agentAccountId)) {
  return NextResponse.json({ ok: true, skipped: 'not_my_chat' })   // 不归我管，闭嘴
}
```

> 前提：webhook 注册时勾了 `chat_presence_user_ids`（文档①§2.0）。

### 2.1 自回声过滤（文档 ① 修复 C）

AI 以 agent 身份发的消息会再次触发 `incoming_event`（author = 该 agent）。不过滤 → Intera 自言自语，肉眼看像"多个 AI"。

```ts
// webhook 路由，分发前：
if (config.agentAccountId && (event.author_id as string) === config.agentAccountId) {
  return NextResponse.json({ ok: true, skipped: 'self_authored' })
}
```

### 2.2 会话归属抢占（chat ownership guard）

让 Intera 在首次处理某 chat 时，往 chat property 写一个归属标记；后续只处理"自己拥有 / 无人拥有"的会话。

**写归属**（已有 `updateChatProperties`，[livechat-api.ts:179](apps/chat/lib/livechat/livechat-api.ts:179)）：
```ts
// bridge.handleIncomingEvent，建完 session 后：
await updateChatProperties(chatId, { owner: 'intera' }, config.botAccessToken, config.licenseId, config.region).catch(() => {})
```

**读归属再决定是否响应**：webhook/bridge 入口先 `get_chat` 读 `intera.owner`，若已被别的系统占（或你定义的规则）就跳过。

> 局限：别家 app 不认你的 property，挡不住它们；但能保证**Intera 内部**单一归属、便于排障，也为将来"人工接管后 AI 退场"留钩子。

### 2.3 单响应者去重锁（防 webhook 重投/并发双跑）

`/api/messages` 已有 caseId 级并发锁（[messages/route.ts:714](apps/chat/app/api/messages/route.ts:714) `hasSession`），webhook 也有 dedup（`isDuplicateWebhook`）。**保持启用**即可，别绕过。这层防的是"同一条消息被处理两次"，和"多 app"不同但症状相似。

---

## 3. 人工接管时让 AI 退场（顺带，避免和人工抢答）

当会话 transfer 给人工 / 进入 `waiting_human` 时，Intera 不应再自动回复。现状：
- `escalated` SSE → `transfer_chat`（[renderer.ts:126](apps/chat/channels/livechat/renderer.ts:126)），会话转走；
- 但 transfer 后若访客再发消息，webhook 仍会进 bridge → 仍会跑 agent。

建议：bridge 在 session.state === `transferred` 时，只 buffer/记录、不再调用 agent loop（或 agent 侧已有"waiting_human 只致歉不调工具"逻辑，见 [loop.ts:447](apps/chat/lib/agent/loop.ts:447) consultation 分支——确认它对 LiveChat 路径同样生效）。这属于"和**人工**抢答"，与"和**别的 agent/集成**抢答"是两件事，但都收敛到"谁在这个 chat 里（`chat_presence_user_ids`）"这条主线——人工在场则 AI 让位。

---

## 4. 验收标准（本文档）

- [ ] §1.1 盘点表：列出 license 18578946 上所有会发消息的 app / agent / 自带 ChatBot 及其当前状态。
- [ ] 非 Intera 的 webhook 订阅已 Disable；自带 ChatBot 自动 story 已关。
- [ ] Intera 接管的 agent = Primary + `accepting_chats`，人工 = Backup；Routing rules 指向该 Group。
- [ ] 测试页发一条消息 → **只有一条**回复。
- [ ] 代码侧：**`chat_presence_user_ids` 在场过滤生效（最关键）**；`agentAccountId` 自回声过滤生效；可选 chat property `intera.owner` 在首触写入。
- [ ] 人工接管后（人工在场），Intera 不再自动抢话。

---

## 5. 涉及文件 / 配置清单

**平台配置（无代码）**：Developer Console chat webhooks（含 `chat_presence_user_ids`）、Agent App Integrations、ChatBot story、Group Primary/Backup、agent routing status、Chat routing rules。

**代码（主解药 + 兜底）**：
- `apps/chat/app/api/livechat/webhook/route.ts` + `[customerId]/route.ts`（**`chat_presence_user_ids` 在场过滤（=文档①修复F，最关键）** + self-author 过滤）
- `apps/chat/lib/livechat/bridge.ts`（可选写 `intera.owner`、transferred/人工在场时不再跑 agent）
- `apps/chat/lib/livechat/livechat-api.ts`（`updateChatProperties` 透传 region；按需新增 `setRoutingStatus`/`getChat`）
- LiveChatConfig.`agentAccountId`（文档 ① 已加）

---

## 参考来源（LiveChat / Text Platform 官方）

- license webhook（按 Client ID）vs bot webhook（绑 bot + 受 routing 状态控制）、`accepting_chats` / `not_accepting_chats`、author_id 过滤：LiveChat bot webhooks 教程
- 多 app 都会收到 `incoming_event` 的广播语义：Webhooks 自定义集成文档
- `set_routing_status` / `list_agents` / chat properties：Agent Chat API reference
