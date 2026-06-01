# LiveChat 问题：追加消息后 agent 无文本输出

> 日期：2026-06-01
> 诊断方式：trace 分析 + 代码审计

---

## 现象

LiveChat 里发了"最近的取款呢"，同时有追加消息"还有 kyc"被 queue 注入。agent 调了 `get_latest_withdrawal` 并成功拿到结果，但**没有输出任何文本**给 LiveChat，直接静默结束。

下一个用户消息"你好"触发后，agent 才回复"刚才帮你查了取款和 KYC..."

## 根因

`loop.ts:322` 的 queued message 注入格式：

```ts
content: `[SYSTEM] 用户补充了新信息：${pending.content}`
```

模型收到 `[SYSTEM]` 前缀的消息后，把它当成**系统指令**而非需要回复的对话。所以它执行了 tool（正确），但认为"工作完成"后不需要生成文本。

trace 确认：`get_latest_withdrawal` 执行成功 → `stop_reason: end_turn` → 无 text_delta → bridge flush 空 buffer → LiveChat 没收到任何消息。

**不是 bridge 问题，是 prompt/model 行为问题。**

## 建议

### 方案 A（推荐 — 最小改动）

改注入内容格式，明确要求模型生成面向客户的回复：

```ts
// 旧
content: `[SYSTEM] 用户补充了新信息：${pending.content}`
// 新
content: `[SYSTEM] The customer sent an additional message while you were working. Process it and respond to the customer with your findings: ${pending.content}`
```

### 方案 B（更激进）

去掉 `[SYSTEM]` 前缀，直接当用户消息注入。风险是模型可能困惑"谁发了这条消息"。

### 方案 C（bridge 兜底）

bridge 侧检测：如果 loop 结束时有 tool 结果但没有文本输出，自动追加一条"收到您的补充信息，正在处理..."

---

## 验证

改动后：发"帮我查存款"，同时追加"还有 kyc" → agent 应输出文本说明 tool 结果。
