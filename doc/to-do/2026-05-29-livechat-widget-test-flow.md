# LiveChat Widget 端到端手动测试流程

> 日期: 2026-05-29（已更新至 5 bug 修复后 + Vendor 重命名）
> 基于: `doc/to-do/livechat-end-loop-fixes.md` + `doc/to-do/2026-05-29-livechat-widget-bugs.md`
>
> **2026-05-29 更新**: 以下 5 个 bug 已修复并部署，本文档所有测试步骤已更新至修复后行为：
> - BUG-A ✅ 图片 MIME 校验（非图片附件走文本降级）
> - BUG-B ✅ 流中 LLM 错误 → 用户看到"系统繁忙"提示
> - BUG-C ✅ Drain followup 回复持久化到 DB
> - BUG-D ✅ 清理 bridge 202 死分支
> - BUG-E ✅ `incoming_chat` 解析 `thread.events`，首条消息不再丢失
>
> 已确认实现到位的先前修复：P0-1 session `resolved` 复用重置、P0-2 退出后 drain、KB BGE/topK15/docCorr0.3、P1-4 瞬时 LLM 错误不误转人工、Case 持久化带 `chatId`、Customer→Vendor 全项目重命名。

---

## 前置条件

- Console LiveChat 页面已配置 `botAccessToken` + `licenseId` + `webhookSecret`
- LiveChat 平台 webhook → `https://intera-chat.up.railway.app/api/livechat/webhook/[vendorId]`
- Console Knowledge 页面: BGE-Rerank + topK 15 + docCorrelation 0.3
- 确认 `agentAccountId` 已在 Console 配置（用于 incoming_chat 的消息过滤）

---

## 测试 1: 首次打开聊天 (incoming_chat) — BUG-E 已修复

| 步骤 | 操作 | 预期 | 内部 |
|------|------|------|------|
| 1.1 | 客户打开 LiveChat Widget，**不发消息** | 看到 "您好，我是智能客服，请描述您遇到的问题～" | `incoming_chat` webhook → `thread.events` 为空 → 发欢迎语 |
| 1.2 | 关闭 Widget，重新打开，立即发 "我的存款什么时候到账？" | **Intera 针对该问题给出回应**，不仅是欢迎语 | `incoming_chat` 带 `thread.events[0]={type:'message', text:'我的存款什么时候到账？'}` → 解析后调用 `handleIncomingEvent` → agent 处理 |
| 1.3 | 再次关闭→重开，发 "今天有什么优惠？" | 再次正常响应 | 同上，每次 reopen 首条消息都被正确解析 |
| 1.4 | — | 首条消息不会被重复响应 | thread event 的 `id` 已通过 `isDuplicateWebhook` 去重 |

**检查**: reopen 后首条消息得到针对性回复（不再是"请描述您遇到的问题～"的死循环）。

---

## 测试 2: 文字消息 → Agent 逐字回复

| 步骤 | 操作 | 预期 | 内部 |
|------|------|------|------|
| 2.1 | 发送 "我存了500块没到账" | 三个跳动点（typing indicator） | `setTypingIndicator(true)` |
| 2.2 | — | 逐字打字机效果 | SSE `text_delta` → `buffer_text` 累加到 DB → `flush_text` → `sendTextMessage` |
| 2.3 | — | 工具执行卡片（如 get_latest_deposit） | `skill_result` + `renderHints.livechat` → `sendCard` / `sendCarousel` |
| 2.4 | — | 回复完整，typing 停止 | SSE `message_stop` → `setTypingIndicator(false)` |

**检查**: 中文无乱码、逐字无卡顿、回复内容合理、富卡片正确渲染。

---

## 测试 3: KB 检索 → 富卡片渲染

| 步骤 | 操作 | 预期 | 内部 |
|------|------|------|------|
| 3.1 | 触发帮助类问题（如 "welcome bonus terms"） | 工具执行中（typing indicator） | `tool_executing` SSE → noop（typing indicator 提供动画） |
| 3.2 | — | **卡片** 或 **横滑轮播** | `skill_result` → `renderSkillByHint` → `sendCard`/`sendCarousel` |
| 3.3 | — | 结果 #1 是真正相关的条目 | BGE-Rerank + 客户端按 score 降序重排 |
| 3.4 | — | 卡片有标题/副标题/按钮 | `LivechatCardHint` 字段映射（$.title, $.snippet） |

**检查**: KB 结果排序合理、卡片字段不空、按钮可点击。

---

## 测试 4: 图片上传 — BUG-A 已修复

| 步骤 | 操作 | 预期 | 内部 |
|------|------|------|------|
| 4.1 | 上传一张 PNG/JPG 截图 | 图片出现在聊天中，Agent 理解图片内容 | webhook `event.type === 'file'` → `isSupportedImageType` 通过 → `downloadAndEncode` → 验证 `Content-Type: image/png` → base64 → `contentBlocks` → multimodal API |
| 4.2 | 上传一个 PDF 文件 | **不报错**，显示 "用户上传文件: xxx.pdf (application/pdf)" | `isSupportedImageType` 返回 false → 文本降级，不构造 image block |
| 4.3 | 上传文件但 `content_type` 缺失 | **不报错**，显示 "用户上传文件: xxx (未知类型)" | `isSupportedImageType(undefined)` → false → 文本降级 |
| 4.4 | 上传图片但下载失败 | 提示 "用户上传了图片但下载失败" | `downloadAndEncode` 抛错 → catch 块文本降级 |

**检查**: 图片正确编码/理解；非图片文件 / 无类型 / 下载失败 → 不报错，有友好降级提示。

---

## 测试 5: 表单交互 (request_user_input → Moments webview)

| 步骤 | 操作 | 预期 | 内部 |
|------|------|------|------|
| 5.1 | 描述需补充信息的场景 | 卡片 + "Fill Form" webview 按钮 | `request_user_input` → SSE `form_request` → `sendCard`（button type=webview, URL 含 fields JSON） |
| 5.2 | 点击按钮 | LiveChat 内 webview 打开，表单字段由 URL params 动态渲染 | `?view=form&caseId=...&title=...&fields=[...]` → FormCard |
| 5.3 | 填写 + 提交 | webview 关闭，答案以 `sendMessage` 回流到聊天 | Moments SDK: `sendToLiveChat → sendMessage('Form submitted: { ... }')` → webhook 接收 |
| 5.4 | — | Agent 用表单数据继续调查 | `formResult: { answers }` → `confirmedFacts` 注入 |

**检查**: 字段由 LLM 动态定义，渲染正确、answer 传递正确、Agent 消费表单数据后继续执行。

---

## 测试 6: 选项交互 (propose_interaction → Quick Replies)

| 步骤 | 操作 | 预期 | 内部 |
|------|------|------|------|
| 6.1 | 触发需要澄清的问题 | 文字 + 2~4 个快捷回复按钮 | `propose_interaction` → SSE `interaction_proposed` → `send_quick_replies` |
| 6.2 | 点击某个按钮 | postback 被解析为结构化 `interactionResult` | postback `action:itemId` → bridge `buildMessagesBody` → `{ interactionResult: { optionId, input } }` |
| 6.3 | — | Agent 根据选择继续 | Agent 收到 `propose_interaction result` |

**检查**: 按钮数量合理、标签正确、postback 解析正确（结构化回流而非纯文本）。

---

## 测试 7: 人工升级 (transfer_chat) — P1-4 已修复

| 步骤 | 操作 | 预期 | 内部 |
|------|------|------|------|
| 7.1 | 触发人工升级场景（如多次 policy 冲突） | "正在为您转接人工客服…" 或卡牌提示 | **仅刻意交接**（`create_human_task` / policy / max_nudges）→ SSE `escalated` |
| 7.2 | — | 聊天转给人工分组 | bridge `transferChat(target)` → session state=`transferred` |
| 7.3 | 客户再发消息 | 不触发 Agent | bridge 检查 `transferred` → 跳过 agent loop |
| 7.4 | **模拟 LLM API 瞬时错误** | **不转人工**，用户看到 "系统繁忙，请稍后重试"（BUG-B 已修复） | loop 返回 `machine_error`，SSE `error` → renderer `send_text` |

**检查**: 真升级才 transfer；瞬时错误不误转人工且用户有提示。

---

## 测试 8: 并发消息 — P0-1 + P0-2 + BUG-C 已修复

| 步骤 | 操作 | 预期 | 内部 |
|------|------|------|------|
| 8.1 | 发消息 1 "我存了钱没到账" | Agent 处理中 | AgentLoop 启动，`hasSession=true`，并发护栏生效 |
| 8.2 | 1 秒后发消息 2 "是 bKash 存的" | 消息 2 排队，SSE 返回 `withheld` + `message_stop{reason:queued}` | route 返回 200 SSE（不是 202），`enqueueMessageOrCreate` |
| 8.3 | — | 消息 2 被消费，回复包含补充信息 | 两条路径：① loop 迭代中 drain → `[SYSTEM] 用户补充了新信息`；② P0-2 退出后 drain → followup loop |
| 8.4 | 刷新会话 / 下一轮对话 | **消息 2 的用户消息和 agent 回复都出现在历史中** | BUG-C 已修复：followup 的结果实时持久化到 messages 表 |

**检查**: 不启动并行 loop、消息 2 被消费、DB 中两条往返完整（用户消息×2 + agent 回复×2）。

---

## 测试 9: 聊天归档 → 重新打开 — BUG-E 已修复

| 步骤 | 操作 | 预期 | 内部 |
|------|------|------|------|
| 9.1 | LiveChat 后台归档 | — | `chat_archived` → `closeSession` |
| 9.2 | 客户重新发消息（带 `incoming_chat`） | **首条消息得到针对性回复**（不再是仅有欢迎语） | `incoming_chat` → 解析 `thread.events` → agent 处理 |
| 9.3 | — | 新 session，新 caseId | `generateCaseId()` 生成新 ID，旧 session 不复用 |

**检查**: 归档后全新开始，首条消息不丢失，不复活旧 session。

---

## 测试 10: 异常路径 — BUG-B 已修复

| 步骤 | 操作 | 预期 | 内部 |
|------|------|------|------|
| 10.1 | `/api/messages` 请求本身失败 / 返回非 2xx | "系统繁忙，请稍后重试" | bridge `sendFailureNotice('engine_unreachable')` + 重试队列 |
| 10.2 | **流已建立后** LLM API 报错（重试耗尽） | **用户看到 "系统繁忙，请稍后重试"**（BUG-B 已修复） | loop 发 `error` SSE → renderer `case 'error'` → `send_text` |
| 10.3 | Token 过期 | 渠道标记 unhealthy，给用户发送通知 | `markChannelUnhealthy('token_expired')` |
| 10.4 | 系统空闲消息 | 聊天自动 deactivate | 正则匹配 → `deactivateChat()` |

**检查**: 所有错误路径都有用户可见的兜底提示，不会静默。

---

## 测试 11: Vendor 重命名验证

| 步骤 | 操作 | 预期 |
|------|------|------|
| 11.1 | 打开 Console → 登录 | Cookie 名为 `intera_vendor_id`（非 `intera_customer_id`） |
| 11.2 | Console 侧边栏 | 显示 "API Vendor" / "Demo Vendor"（非 "customer"） |
| 11.3 | Console → Tools 页面 | 技能卡片上如有 LiveChat 适配，显示 `🔌 LiveChat` 标签 |
| 11.4 | Console → Channels → LiveChat → Rendering 标签 | Moment Preview 可以预览表单 |
| 11.5 | Agent prompt 中 | 不出现 `customerId` 或 `Customer`（指租户时用 `vendorId`/`Vendor`） |

---

## 检查清单

| # | 项目 | ✓ |
|---|------|---|
| 1 | 首次打开 + 发消息 → 首条消息不丢失 | ☐ |
| 2 | 文字消息 → 逐字回复 + 富卡片 | ☐ |
| 3 | KB 检索 → 卡片/轮播排序合理 | ☐ |
| 4 | 图片上传 → 模型理解；非图片 → 降级不报错 | ☐ |
| 5 | 表单 webview → 填写 → Moments SDK 回流 | ☐ |
| 6 | 快捷回复按钮 → 结构化 postback → Agent 继续 | ☐ |
| 7 | 真升级 → transfer；瞬时错误 → 有提示不转人工 | ☐ |
| 8 | 并发消息 → 排队消费 + DB 完整持久化 | ☐ |
| 9 | 归档 → 重开 → 首条消息不丢失 | ☐ |
| 10 | 所有错误路径 → 用户有兜底提示 | ☐ |
| 11 | Console 正常登录，UI 显示 Vendor 非 Customer | ☐ |
