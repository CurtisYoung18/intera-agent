# Intera Agentic Customer Service Harness — 架构梳理文档

> 项目路径：`/Users/curtis/Desktop/Tools/intera-agent`
> 文档目的：统一对产品架构的认知，梳理模块边界和关键数据链路。
> 最后更新：2026-05-13 ｜ 版本：生产就绪 v1.1
>
> **产品定位**：Intera 是一个由 AI Agent 主导、以问题解决为目标的客服 SaaS。Agent 作为 Case Owner，对每一个 case 全程负责——理解目标、收集证据、制定计划、调用工具、协调人工、持续推进，直到闭环。系统目标不是"回复消息"，而是"解决问题"。
>
> **核心哲学**：
> - **Case 不是对话**，是任务。处理单位从 message 升级为 case，Agent 持有完整状态跨轮次推进。
> - **人工不是转接**，是后台资源。Agent 自己找人工，把问题总结好、把证据准备好，人工只回答结构化问题，结果由 Agent 带给用户——用户面对的始终是同一个 Agent。
> - **检索不是为了回答**，是为了决策。知识库召回给 Agent 提供可引用、可验证、可行动的证据，而不是直接拼给用户看。
> - **规则不是流程**，是边界。Policy 定义的是 Agent 的行为红线，不是执行剧本。
>
> **设计理念**：不做 Flow-Chatbot（预先设计好的流程图 + 规则树 + 节点跳转）。做一个 **Agentic Harness**——围绕 Case 运行的 Agent 执行系统。Agent 根据当前目标和证据动态决定下一步，不要求预先写完所有流程，可以中途改计划、串联多个动作、请求人工、恢复执行。
>
> **路由**：`/chat`（顾客端），`/ops/*`（运营后台），`/admin/*`（配置后台）。API: `/api/messages`, `/api/human-chat`, `/api/human-tasks/*`。

---

## 一、整体架构总览

```
B 端商户（B-side Customer）
    │
    └── C 端顾客（user_id）
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│  /chat 页面                                              │
│  ChatShell (React Client)                                 │
│   - CaseCard（浮动 Case 仪表盘）★ Agent 识别到 case 即出现     │
│   │    浮动于左上角（窄屏自动移至右上角），展示当前活跃 case      │
│   │    Agent 确认 facts/skills 后卡片滑入，展示实时状态           │
│   │    无 case 时无卡片；case resolved 后可 Dismiss 关闭        │
│   │    30 秒无更新自动折叠为 pill 状态，点击展开                  │
│   - ChatPanel（当前 case 的对话 + 气泡 + Timeline）           │
│   - Trace 时间线在 Console /ops/cases/[id] 详情页展示          │
└─────────────────────────────────────────────────────────────┘
    │ POST /api/messages
    ▼
┌─────────────────────────────────────────────────────────────┐
│  API Route: /api/messages                               │
│  职责：接收 user message，调用 runAgentTurn()                 │
│  文件：app/api/messages/route.ts                         │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent Loop: /lib/agent/loop.ts          ★ 核心引擎 ★     │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │              Transition-Driven Loop                   │   │
│  │                                                       │   │
│  │   while (true) {                                      │   │
│  │     上下文压缩 → API流式调用 → 工具执行 → state=next │   │
│  │   }                                                   │   │
│  │   state.transition.reason 标记原因：                  │   │
│  │    · next_turn          — 正常下一轮                  │   │
│  │    · collapse_drain_retry — 上下文塌陷恢复            │   │
│  │    · reactive_compact_retry — 反应式压缩重试          │   │
│  │    · max_output_tokens_escalate — 输出超限升级        │   │
│  │                                                       │   │
│  │   Act 阶段内部会调用以下子模块：                       │   │
│  │   ┌─────────────────────────────────────────────┐   │   │
│  │   │  Memory（memory.ts）  ←── 每次 Act 后读写     │   │   │
│  │   │  Skills（skills.ts） ←── LLM 决定调用哪个     │   │   │
│  │   │  Policy（policy.ts） ←── skill 前后执行检查   │   │   │
│  │   │  Trace（trace.ts）  ←── 每步操作都记录       │   │   │
│  │   │  Profiler（profiler.ts）← 关键节点埋点       │   │   │
│  │   └─────────────────────────────────────────────┘   │   │
│  │                                                       │   │
│  │   退出条件（满足任一即结束本轮 Loop）：                │   │
│  │   · LLM 返回纯文本（无 tool_use）                    │   │
│  │   · create_human_task 成功 → case 进入 waiting_human │   │
│  │   · finalize_case 成功 → case 进入 resolved           │   │
│  │   · 超过 maxIterations                               │   │
│  │   · withheld 恢复失败 → 错误升级                     │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ★ StreamingToolExecutor（工具并行执行）：                    │
│   · LLM 边流式生成边执行工具，不等完整 tool_use block        │
│   · isConcurrencySafe=true 的工具批量并行执行               │
│   · isConcurrencySafe=false 的工具单独串行执行              │
│   · 工具状态追踪：queued → executing → completed/yielded    │
│   · SSE 实时推送 tool_executing / tool_progress 事件         │
│                                                              │
│  内置 Skills（系统自带，可按需编辑 mock 逻辑）：               │
│   ★ read_case_history        — 读取顾客历史 case             │
│   ★ create_human_task        — 发起人工确认任务               │
│   ★ finalize_case            — 闭环 case                     │
│   ★ kb_hybrid_retrieve       — 知识检索（mock）               │
│                                                              │
│  技术人员可新增（通过 Admin 配置自定义 skill）：              │
│   ★ query_order_status        — 查平台订单                  │
│   ★ query_payment_channel_status — 查支付渠道状态           │
│   ★ search_delay_notice       — 检索全局公告                │
│   ★ ocr_receipt              — 识别支付凭证截图               │
└─────────────────────────────────────────────────────────────┘
              │
              │ Agent Loop 结束（waiting_human 或 resolved）
              ▼
┌─────────────────────────────────────────────────────────────┐
│  Human Task 恢复流程（跨请求的异步闭环）                     │
│                                                              │
│  ┌──────────────────────┐     ┌────────────────────────┐  │
│  │  人工 Task 页面       │     │  人工填写结构化回执     │  │
│  │  /ops/human-tasks │ ←── │  verdict / expected_eta │  │
│  └──────────────────────┘     └────────────────────────┘  │
│              │ POST /api/human-tasks/[id]/resolve        │
│              │                                            │
│              ▼                                            │
│  · HumanTask.status → resolved                        │
│  · Case.status → investigating（blocker 清空）         │
│  · 异步触发 runAgentTurn({ resumeTrigger })              │
│  · Agent Loop 重新启动，从 Observe 恢复执行                 │
└─────────────────────────────────────────────────────────────┘
```

**图示分层说明：**

- **大框（Agent Loop）** = 一个完整的 transition-driven 循环，`runAgentTurn()` 函数就是整个循环的封装
- **Transition 原因** = 标记循环为何继续（next_turn / collapse_drain_retry / reactive_compact_retry 等）
- **子模块（Memory / Skills / Policy / Trace / Profiler）** = Act 阶段内部被调用的支撑模块
- **Human Task 恢复流程** = 跨请求的异步闭环，独立于当前请求的生命周期

**为什么 Skills / Policy / Trace / Memory 没有单独画在 ReAct 步骤之间？**
因为 Act 阶段可能多次调用 Skills（多轮 tool_use），Policy 在 skill 前后都要检查，Trace 每一步都要写，Memory 每一步都要读。把它们平铺在步骤之间会让图变得很复杂。所以用虚线框把它们整体放在 Act 阶段内部，表示"这些是 Act 的支撑能力"。

**Trace 可观测性（更新于 2026-05-07）：**
- Trace 的最小单位是 Case
- Trace 时间线在 **Console `/ops/cases/[id]` 详情页**展示（非 Chat 端）
- CaseCard 仅展示当前 case 的实时摘要（状态/facts/skills/missingFacts）

---

## 二、Agent Loop（核心引擎）

**文件：** `lib/agent/loop.ts`

### 2.1 Agent Loop 流程图

```
用户消息入站
    │
    ▼
┌─ 1) 上下文压缩 ────────────────────────────────────────────┐
│  按需触发以下策略（参考 Claude Code compact.ts）：           │
│   · Microcompact      → 工具结果去重（minAgeMs 保护新鲜缓存） │
│   · Context Collapse  → 提交日志方式压缩                   │
│   · Autocompact       → 生成摘要（阈值 40k buffer tokens）  │
│   · Snip              → 消息裁剪（保留 65%，最低 6 条）     │
│  配置项：AgentConfig.memoryStrategy                         │
└────────────────────────────────────────────────────────────┘
    │
    ▼
┌─ 2) 写 Message（role=user）─────────────────────────────┐
│  同时写 ActionTrace（type=user_message）                  │
└────────────────────────────────────────────────────────────┘
    │
    ▼
┌─ 3) ingestUserMessageFacts() ─────────────────────────────┐
│  用 LLM（MiniMax-M2.7-highspeed）从用户文本提取结构化事实    │
│  提取 extractedFacts + flags（userReportedNotReceived 等）   │
│  ★ 2026-05 重构：替换原有 txnIdPattern/amountPattern/       │
│    notReceivedKeywords 正则匹配，改用 LLM 语义理解           │
└────────────────────────────────────────────────────────────┘
    │
    ▼
┌─ 4) 检查 case.status === waiting_human？ ──────────────────┐
│  是 → 发通知、暂停，不进入 Agent Loop                        │
└────────────────────────────────────────────────────────────┘
    │
    ▼
┌─ 5) 构造 API 上下文 ───────────────────────────────────────┐
│  - recentMessages（取最近 N 条，可配置，默认 12 条）           │
│  - systemPrompt（base + caseContextBlock + memorySummary）   │
│  - tools（从 SkillRegistry 动态加载）                   │
└────────────────────────────────────────────────────────────┘
    │
    ▼
┌─ 6) while (true) — Transition-Driven Loop ─────────────────┐
│                                                              │
│  ┌─ LLM Stream（边生成边吐，异步触发 Skills）────────────┐  │
│  │                                                        │  │
│  │  调用 Anthropic/MiniMax API，streaming 返回             │  │
│  │                                                        │  │
│  │  SSE 实时推送（LLM 边生成 边推送，不等完整响应）：      │  │
│  │   · stream_request_start → API 请求开始               │  │
│  │   · thinking_delta       → 扩展思考内容               │  │
│  │   · text_delta           → 文本片段                   │  │
│  │   · tool_executing       → ★ 工具开始执行时立即推送    │  │
│  │   · tool_progress        → 长时工具实时输出（如 Bash） │  │
│  │   · skill_call           → 检测到 tool_use 时立即推送  │  │
│  │   · withheld             → 错误 withheld（暂缓显示）   │  │
│  │                                                        │  │
│  │  当 LLM 吐出 tool_use block 时，加入 StreamingToolExecutor：│
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │  ★ StreamingToolExecutor（工具并行执行）         │  │  │
│  │  │                                               │  │  │
│  │  │  工具状态：queued → executing → completed     │  │  │
│  │  │                                               │  │  │
│  │  │  isConcurrencySafe=true → 批量并行执行         │  │  │
│  │  │  isConcurrencySafe=false → 单独串行执行         │  │  │
│  │  │                                               │  │  │
│  │  │  preTool Policy 检查 → 通过 / 拒绝            │  │  │
│  │  │        ↓                                       │  │  │
│  │  │  runSkill() → mock / http                    │  │  │
│  │  │        ↓                                       │  │  │
│  │  │  applySkillResultToMemory()                    │  │  │
│  │  │        ↓                                       │  │  │
│  │  │  postTool Policy 检查 → hint / blocked       │  │  │
│  │  │        ↓                                       │  │  │
│  │  │  SSE 推送 skill_result → 前端显示结果         │  │  │
│  │  │        ↓                                       │  │  │
│  │  │  特殊工具处理（create_human_task / finalize_case）│  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  LLM 完整生成完毕后：                                  │  │
│  │  追加 tool_result blocks 到 messages                   │  │
│  │  state.transition = { reason: 'next_turn' }           │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  退出条件（满足任一即结束本轮 Loop）：                       │
│   · LLM 返回纯文本（无 tool_use）→ 写 agent 消息，done   │
│   · create_human_task 成功 → case=waiting_human，done    │
│   · finalize_case 成功 → case=resolved，done             │
│   · 超过 maxIterations → 报错                            │
│   · withheld 恢复失败 → 错误升级                         │
│   · message_stop（reason）→ 消息生成结束                  │
└─────────────────────────────────────────────────────────────┘

**Abort 与错误恢复（2026-05 补强）：**

| 机制 | 说明 |
|------|------|
| AbortController 接线 | `AbortController.signal` 传入 Anthropic stream、HTTP fetch；loop 迭代前检查 `signal.aborted` |
| safeSendEvent | `run()` 入口包装 sendEvent：try/catch + 失败时设 `aborted=true`，后续调用静默跳过 |
| Stream 错误恢复 | for-await 包 try/catch，异常时 drain 已入队 tools 后继续 |
| 阶段评估保护 | `evaluateTransition` 包 try/catch，失败 fallback `shouldTransition: false` |
| 阶段评估 JSON 稳定 | Assistant pre-fill（`{"`）强制模型输出 JSON。Provider 不支持时自动回退重试。连续 3 次解析失败后断路器降级为基于规则的自动推进（evidence + skills 满足即前进） |
| PostTool 评估保护 | `evaluatePostToolBatch` 包 try/catch，失败跳过 postTool 检查 |
| 策略引擎降级 | LLM 评估失败返回 `{ result: 'hint' }` 而非静默 `pass`，避免 API 抖动时安全策略失效 |
| 升级前调查保护 | `investigate_before_escalation` 策略：preTool 阶段阻止 `create_human_task`，直到 `query_order_status` / `query_payment_channel_status` / `query_account_status` 任一已调用 |
| Anthropic client 复用 | AgentLoop 构造时创建单一实例，迭代间复用（不再每轮 `new Anthropic()`） |
| 输入校验 | API 路由 body 上限 100KB、customerId 格式限制 `[a-zA-Z0-9_-]+` ≤64字符、message 上限 50K 字符 |

### 2.1.1 前端 SSE 事件与 UI 动画（更新于 2026-04-30）

Skills 异步执行期间，前端通过 SSE 实时接收事件，驱动 UI 动画：

| SSE 事件 | 前端行为 |
|---|---|
| `stream_request_start` | 显示"正在连接…" |
| `thinking_delta` | 显示 LLM 思考动画 + 文字 |
| `text_delta` | 流式显示 LLM 生成的文本 |
| `tool_executing` | **立即显示工具执行动画**（图标旋转 + "正在调用 xxx…"） |
| `tool_progress` | 长时工具的实时输出（如 Bash 输出进度） |
| `skill_call` | 归入 tool_executing，合并显示 |
| `skill_result` | 工具执行完成动画（成功/失败图标），展示结果摘要 |
| `memory_update` | Case 卡片更新（confirmedFacts / missingFacts 变化） |
| `case_status` | Case 状态变化高亮动画 |
| `human_task_created` | Case 卡片进入 waiting_human 状态 |
| `consultation_complete` | 人工处理完成通知（事件驱动，含 summary/resolution）。Chat page 显示过渡消息（zh/en 双语自动检测） |
| `intent_classified` | 意图分类完成，前端决定是否展示 Split 动画 |
| `case_created` | 自动建案成功，前端创建 Case Tab + 右面板滑入 |
| `sub_agent_start` | 专职 Agent 开始执行，前端显示进度卡片 |
| `sub_agent_progress` | 专职 Agent 工具调用/思考中，更新卡片状态 |
| `sub_agent_complete` | 专职 Agent 完成，卡片变绿展示发现详情 |
| `sub_agent_error` | 专职 Agent 超时/失败，卡片变红展示错误 |
| `finalized` | 闭环成功动画 + 结果卡片展示 |
| `message_stop` | 消息生成结束（含 transition reason） |
| `withheld` | 错误 withheld（恢复成功前暂缓显示） |

动画风格参考 Claude Code：Skill 执行时有明显可辨识的"工具调用中"状态（图标旋转 + 文字描述），完成后有结果反馈。多个并行工具时，各自独立显示进度条。

### 2.1.2 关键性能指标（Query Profiler）

| 指标 | 说明 |
|---|---|
| TTFT (Time To First Token) | 首 token 延迟，LLM 开始生成的速度 |
| pre-request overhead | 请求前开销占比 |
| network latency | 网络延迟占比 |
| tool_execution_total | 工具执行总时长 |
| compaction_count | 上下文压缩次数 |

Profiler 检查点（在 `lib/agent/profiler.ts` 中定义）：
```
query_user_input_received → query_fn_entry
→ query_snip_start / query_snip_end
→ query_microcompact_start / query_microcompact_end
→ query_autocompact_start / query_autocompact_end
→ query_setup_start / query_setup_end
→ query_api_streaming_start / query_api_streaming_end
→ query_tool_execution_start / query_tool_execution_end
→ query_recursive_call
```

### 2.2 Case 的定位

Case 是 Agent 处理问题的**最小工作单元**——不是"一次对话"，而是"一个需要被解决的用户问题"。

Case 有以下核心特征：

| 属性 | 说明 |
|---|---|
| **有状态** | Case 是持久化的有状态实体，从创建到闭环全程可追踪 |
| **归属 user_id** | 每个 Case 属于一个 C 端顾客（user_id），顾客可查看自己所有历史 case |
| **有 type** | Case type 决定使用哪套状态机（如 `deposit_issue` / `account_ban`） |
| **有 Memory** | 每个 Case 有自己的 confirmedFacts / skillResults / keyEvents |
| **可中断恢复** | waiting_human 时暂停；人工回执后通过 resumeTrigger 恢复执行 |
| **有 Trace** | Case 整个生命周期内的操作都有时间线记录 |

```
Case #12345
  user_id: u_try_1
  type: deposit_issue
  status: waiting_human
  currentGoal: "确认充值是否到账，如未到账申请补单"
  memory:
    confirmedFacts: { txnId: "TXU1_12345", amount: 500 }
    missingFacts: ["receipt_screenshot"]
    skillsCalled: ["query_order_status"]
  blocker: "等待 payment_ops 人工确认渠道批次状态"
```

Case 的状态由 `CaseSchema.stages` 动态配置，不是固定的。

### 2.3 Case 状态机（动态配置）

Case 的状态**不是写死的**，而是每个 Case Type 有自己的状态机，由 `CaseSchema.stages` 定义。

例如 `deposit_issue` 的 stages：
```
created → collecting → investigating → waiting_human → resolved
```

Agent 在 loop 中通过 `finalize_case` 工具将 case 推进到 `resolved` 状态（或 `escalated`）。状态的含义和流转由 Admin 后台配置决定。

### 2.4 多 Case 并行策略

**Demo 阶段（当前）**：方案 B
- 同一用户同一时刻只有一个活跃 case 在跑 Agent Loop
- 但用户能在 UI 上看到所有 case 的状态（created / collecting / investigating / waiting_human / resolved）
- 用户可切换查看不同 case 的进度

**未来演进方向**：方案 A
- 同一用户可同时有多个 case 在跑独立 Agent Loop
- 需要解决：并发写 case memory 的冲突、LLM 并发调用配额、UI 多 case 状态同步

---

## 三、Case Memory（案例记忆）

**文件：** `lib/agent/memory.ts`

**Admin 配置：** `AgentConfig.memoryStrategy`（keyEvent 抽取提示词、四层上下文压缩策略等）

### 3.0 解释说明

> > Case Memory 是 Agent 的工作记忆，不是聊天记录。

> 传统客服靠上下文窗口记住对话，我们靠 Case Memory 让 Agent 跨轮次持有完整任务状态。Agent 不只记住"聊了什么"，而是记住：证据收集到了哪一步、还缺什么、已经调用了哪些工具、当前卡在哪里、人工是否在处理中。

> | 字段 | 含义 |
> |---|---|
> | `confirmedFacts` | 已确认的证据（订单号、金额、用户声称 vs 系统数据） |
> | `missingFacts` | 仍缺失的关键字段，驱动 Agent 继续提问或查工具 |
> | `skillsCalled` | 本 case 已调用的 skill 历史，防止重复调用 |
> | `skillResults` | skill 执行结果，作为后续决策的输入 |
> | `keyEvents` | 关键事件时间线，Agent 和人工共享同一个 case 上下文 |
> | `humanTaskStatus` | 人工介入状态：pending / in_progress / resolved |
> | `summary` | 对话摘要，用于上下文压缩后仍保留长程记忆 |

> Case Memory 持久化在 DB 中，caseId 不变则 Agent 重启、用户换设备都能恢复同一状态。

### 3.1 Case Memory 数据结构

```
┌─────────────────────────────────────────────────────────────┐
│  CaseMemory（每个 Case 一个，与 Case 1:1）              │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  confirmedFacts ──→ 从用户文本或 skill 结果中提取并确认的事实 │
│       │                                                      │
│  missingFacts ───→ 仍缺失的字段（如 txnId / channel）        │
│       │                                                      │
│  skillsCalled ───→ 已调用的 skill 名称列表                    │
│       │                                                      │
│  skillResults ───→ skillName → output 的 kv 映射            │
│       │                                                      │
│  keyEvents ─────→ LLM 生成 ★ 的关键事件时间线              │
│       │         （正则备用：用于离线抽取作为兜底）           │
│       │                                                      │
│  humanTaskStatus → pending / in_progress / resolved          │
│       │                                                      │
│  summary ───────→ 对话摘要（用于 prompt）                   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Memory 更新时机与流程

**时机一：用户消息入站**

```
用户发消息
    │
    ▼
┌─ ingestUserMessageFacts() ──────────────────────────────┐
│                                                         │
│  1. 启发式抽取（正则备用）                              │
│     · 匹配 txnId（TX开头）                              │
│     · 匹配金额（XX元）                                  │
│     · 检测"未到账/没到账"等关键词                       │
│                                                         │
│  2. LLM 生成（主方式）                                  │
│     · 调用 LLM，按 keyEventExtractionPrompt 抽取         │
│       关键事件，写入 keyEvents                          │
│                                                         │
│  3. 合并到 confirmedFacts                               │
│  4. 从 missingFacts 删除已确认的字段                     │
└────────────────────────────────────────────────────────┘
```

**时机二：Skill 执行成功返回**

```
Skill 执行成功
    │
    ▼
┌─ applySkillResultToMemory() ───────────────────────────┐
│  · 合并 skill output 到 confirmedFacts                   │
│  · skillName → output 写入 skillResults                  │
│  · skillName 追加到 skillsCalled                         │
│  · missingFacts 同步删除已确认的字段                      │
└────────────────────────────────────────────────────────┘
```

**时机三：人工回执完成**

```
人工提交 /resolve
    │
    ▼
┌─ /resolve 端点 ────────────────────────────────────────┐
│  · humanTaskStatus → resolved                          │
│  · case status → investigating（blocker 清空）          │
└────────────────────────────────────────────────────────┘
```

### 3.3 四层上下文压缩

```
┌──────────────────────────────────────────────────────────────┐
│  L1 · 当前 Case 的最近消息（Recent Messages）                │
│  ──────────────────────────────────────────────────────────  │
│  · 最近 N 条原始对话（可配置，默认 12 条）                   │
│  · 完整保留，不压缩                                         │
│  · Token 消耗最大，但最准确                                │
│  · 注入位置：LLM messages 数组                             │
│                                                              │
│  ★ L1 内部多层压缩（按需触发）：                            │
│   · Microcompact      → 工具结果去重（minAgeMs=60s 保护     │
│                         新鲜缓存，consultation 模式 5min）   │
│   · Context Collapse  → 提交日志方式压缩                   │
│   · Autocompact       → 生成摘要                           │
│  阈值：AUTOCOMPACT_BUFFER_TOKENS = 40_000                    │
│        WARNING_THRESHOLD_BUFFER_TOKENS = 50_000              │
│        BLOCKING_THRESHOLD_TOKENS = 15_000                    │
│  Snip: compactionKeepRatio = 0.65（保留 65%），keepMin = 6   │
│  Token 估计：latinCharPerToken = 4，cjkCharPerToken = 1.5  │
│  ★ circuit breaker（连续 3 次失败后熔断，避免反复调用 API） │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  L2 · Case Memory（Medium-term Context）                    │
│  ──────────────────────────────────────────────────────────  │
│  · confirmedFacts + missingFacts + skillsCalled             │
│  · skillResults 摘要（不保留完整 Tool 原始返回）            │
│  · 当前 case 的 summary（对话摘要）                         │
│  注入位置：system prompt 中的 Case Context Block           │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  L3 · Case Schema + Agent Config（System Context）        │
│  ──────────────────────────────────────────────────────────  │
│  · CaseSchema（当前 case type 的 stages / requiredFacts）│
│  · AgentConfig（systemPrompt / policyHooks）           │
│  · SkillRegistry（可用 skill 列表）                    │
│  注入位置：system prompt（固定部分，不变）                 │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  L4 · 顾客历史 Cases（Long-term Memory）                   │
│  ──────────────────────────────────────────────────────────  │
│  · Agent 调用 read_case_history skill 查询该 user_id         │
│    的历史 resolved cases                                   │
│  · 按 keyEvents + summary 匹配相关历史 case                  │
│  · 通过 keyEventExtractionPrompt 控制抽取粒度               │
│  注入位置：作为 Tool Result 附加到 L1messages 中          │
└──────────────────────────────────────────────────────────────┘
```

### 3.4 keyEvents 的生成方式

keyEvents 是 Case 的"时间线里程碑"，用于：
- L4 历史 case 匹配时的快速摘要
- 人工 Task 页面的上下文摘要
- Case 详情页的时间线展示

**主生成方式：LLM**
- 每次用户消息入站或 Skill 执行完成后，调用 LLM
- 按 `keyEventExtractionPrompt` 的提示词生成关键事件
- 格式：`{ at: ISO时间, text: 事件描述, source: "llm" }`

**备用方式：正则**
- 当 LLM 调用失败或 keyEventExtractionPrompt 未配置时
- 用正则表达式匹配关键词（充值/未到账/人工/闭环等）
- 格式：`{ at: ISO时间, text: 匹配文本, source: "heuristic" }`

**Admin 配置项：**

| 配置项 | 说明 |
|---|---|
| `keyEventExtractionPrompt` | LLM 抽取关键事件的提示词（决定抽取哪些粒度的事件） |
| `contextCompression` | L1-L4 各层注入策略（每层 token 上限、注入方式） |
| `maxRecentTraces` | 注入 prompt cache 的最近 trace 条数上限 |
| `caseRetentionDays` | case 记忆保留天数（影响 L4 历史 case 可检索范围） |

---

## 四、Skills 系统

**文件：** `lib/agent/skills.ts` + `lib/agent/mock-handlers.ts`

**Admin 配置：** `SkillRegistry`（每个 skill 的 name / mode / endpoint / mockFixture 等均可通过 Admin 配置）

### 4.0 解释说明

> 可以这样理解 Skill：
>
> **Skill 就是 Agent "会做的事情"——每个 Skill 是一个可调用的工具，Agent 根据情况决定调用哪一个。**
>
> 类比：就像一个真人客服会"查订单"、"查公告"、"叫主管"一样，我们的 Agent 也会这些，只是每件事对应一个 Skill 工具。
>
> | Skill 名称 | 相当于客服会... |
> |---|---|
> | `query_order_status` | 查一下订单系统 |
> | `query_payment_channel_status` | 查一下支付渠道 |
> | `search_delay_notice` | 查一下有没有延迟公告 |
> | `create_human_task` | 提交一张人工处理单 |
> | `finalize_case` | 宣布这个问题处理完了 |
> | `read_case_history` | 翻一下这个用户的历史记录 |
>
> **Skill 有两种运行模式：**
> - `mock` = 本地模拟（demo 用，不真实调外部系统）
> - `http` = 真实调用（接客户的真实 API）

### 4.1 Skill 调用流程

```
Agent Loop 中 LLM 决定调用 skill
    │
    ▼
┌─ preTool Policy 检查 ───────────────────────────────┐
│  runPolicyHooks("preTool")                          │
│  → blocked？→ 返回错误结果，跳过 skill 执行          │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ StreamingToolExecutor ─────────────────────────────┐
│  工具加入执行队列（addTool）                         │
│       │                                             │
│  ┌────┴────┐                                        │
│  ↓         ↓                                        │
│ isConcurrencySafe=true  isConcurrencySafe=false    │
│  ↓         ↓                                        │
│ 批量并行    单独串行                                │
│       │                                             │
│  工具状态追踪：queued → executing → completed       │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ Skill 路由分发 ───────────────────────────────────┐
│  根据 SkillRegistry.mode 决定：                 │
│                                                      │
│  ┌────────────┐    ┌─────────────────────────────┐  │
│  │ mode=mock  │───→│ 内置 mock-handlers          │  │
│  │            │    │ 读取 demo_* 表返回模拟数据  │  │
│  └────────────┘    └─────────────────────────────┘  │
│  ┌────────────┐    ┌─────────────────────────────┐  │
│  │ mode=http  │───→│ 真实 HTTP endpoint         │  │
│  │            │    │ POST caseId + input        │  │
│  └────────────┘    └─────────────────────────────┘  │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ Skill 执行结果 ───────────────────────────────────┐
│  SkillRunResult {                                    │
│    ok: boolean,                                     │
│    status: "ok" | "error" | "timeout",             │
│    output: unknown,                                 │
│    latencyMs: number,                              │
│    mode: "mock" | "http"                           │
│  }                                                  │
└────────────────────────────────────────────────────┘
    │
    ├──→ 写 SkillCall（审计日志）
    ├──→ 写 ActionTrace（type=skill_result）
    ├──→ SSE 推送 skill_result → 前端显示结果
    └──→ 若 isConcurrencySafe=true 且有其他工具在队列中，立即并行执行下一个
```

### 4.2 内置 Skills（系统自带，可按需编辑 mock 逻辑）

| Skill Name | Handler | 读取表 | isConcurrencySafe | 说明 |
|---|---|---|---|---|
| `read_case_history` | — | `demo_case` | true | 按 user_id 读取该顾客的历史 case |
| `query_order_status` | `runMockQueryOrderStatus` | `demo_mock_order` | true | 查平台订单，返回 status/amount/time |
| `query_payment_channel_status` | `runMockQueryChannelStatus` | `demo_notice` | true | 查渠道状态，返回 delayed_batch 或 normal |
| `search_delay_notice` | `runMockSearchDelayNotice` | `demo_notice` | true | 检索延迟公告 |
| `ocr_receipt` | `runMockOcrReceipt` | 无（随机 fixture） | true | 模拟 OCR，按 attachment_id 前缀返回 |
| `create_human_task` | `runMockCreateHumanTask` | `demo_routing` | false | 创建人工任务，更新 case.status=waiting_human |
| `finalize_case` | `runMockFinalizeCase` | 无 | false | 闭环 case，更新 status=resolved |
| `request_user_input` | `runMockRequestUserInput` | 无（动态表单） | false | 向顾客推送动态表单卡片，收集缺失信息 |
| `finalize_consultation` | `runMockFinalizeConsultation` | 无 | false | 人工咨询结束，Agent 将结果翻译给顾客 |
| `kb_hybrid_retrieve` | `runMockKbHybridRetrieve` | 无（固定 fixture） | true | 模板知识检索槽位 |

**isConcurrencySafe 说明**：
- `true`：可与其他工具并行执行（read-only 类操作）
- `false`：必须单独串行执行（写操作、有副作用的操作）

### 4.3 Admin 中 Skill 的可配置项

在 `SkillRegistry` 中：

| 字段 | 说明 |
|---|---|
| `name` | Skill 名称（Agent 调用时使用） |
| `description` | 描述（供 LLM 理解何时调用） |
| `inputSchema` | 输入参数 schema（Anthropic tool 格式） |
| `outputSchema` | 输出参数 schema |
| `mode` | `mock` 或 `http` |
| `endpoint` | HTTP endpoint（mode=http 时） |
| `httpMethod` | GET / POST（默认 POST） |
| `headers` | 自定义请求头 |
| `timeoutMs` | 超时时间（默认 8000ms） |
| `mockFixture` | mock 默认样本（Admin 可视化展示） |
| `guardPhase` | `pre`（仅注册不自动进工具表）/ `post`（正常注册） |
| `isConcurrencySafe` | true=可并行执行，false=必须串行 |
| `enabled` | 是否启用 |

---

## 五、Policy / Guardrail 系统

**文件：** `lib/agent/policy.ts`

**Admin 配置：** `AgentConfig.policyHooks`（指定该 customer 启用哪些 policy）+ `PolicyConfig`（每条 policy 的 name / rule / enabled）

### 5.0 解释说明

> Policy 是护栏而非流程——定义"不可以做什么"，由 LLM 做语义判断而非关键词匹配。
>
> **2026-05 重构**: 全部 `deny_keywords` / `allow_keywords` 已移除，改为 `evaluationPrompt`（自然语言描述策略意图），由 LLM（MiniMax-M2.7-highspeed）评估。API 失败时降级为 `hint` 而非静默 `pass`。
>
> | Policy Hook | 时机 | 评估方式 |
> |---|---|---|
> | `preTool` | tool 调用前 | `deny_skills` 精确名称匹配 + `require_skills` / `require_skills_any` 前置条件检查（均无需 LLM） |
> | `postTool` | tool 结果后 | **批量 LLM 评估**（单次 API 调用覆盖所有 tool results） |
> | `preFinalize` | finalize_case 前 | `require_skills` 精确匹配 + **LLM 评估** |
>
> | 结果 | 含义 |
> |---|---|
> | `pass` | 合规，继续执行 |
> | `blocked` | 违规，操作被拦截 |
> | `hint` | 有风险，标记但不阻止（LLM 不可用时也返回此结果） |
> | `escalated` | 需要升级人工处理 |

### 5.1 内置 Policy 规则

| Policy Name | Hook | 评估方式 | 说明 |
|---|---|---|---|
| `no_high_risk_account_change` | preTool | 精确名称匹配 | 拦截配置中的高危 skill |
| `investigate_before_escalation` | preTool | 精确名称匹配 | 未调用调查类 skill（query_order_status / query_payment_channel_status / query_account_status）不得调用 create_human_task |
| `conflict_requires_human` | postTool | **LLM 评估** | 系统数据（completed/normal）与用户申报（未到账/缺失）矛盾时 → escalated |
| `evidence_required_before_resolution` | preFinalize | 精确名称匹配 | 未调用必要 skill 不得 finalize |
| `no_compensation_promise` | preFinalize | **LLM 评估** | finalize 承诺赔偿/退款 → blocked |
| `must_cite_basis` | preFinalize | **LLM 评估** | finalize 未引用证据来源 → blocked |

### 5.4 Admin 中 Policy 的可配置项

在 `PolicyConfig` 中：

| 字段 | 说明 |
|---|---|
| `name` | Policy 名称（与 policyHooks 数组中的名字对应） |
| `description` | 描述 |
| `rule` | JSON 规则对象（如 `deny_skills: ["refund_money"]` / `require_skills: ["query_order_status"]` / `evaluationPrompt: "用自然语言描述策略检查内容"`） |
| `enabled` | 是否启用 |

在 `AgentConfig.policyHooks` 中：

| 字段 | 说明 |
|---|---|
| `preTool` | 字符串数组，哪些 policy 名称在 tool 调用前检查 |
| `postTool` | 字符串数组，哪些 policy 名称在 tool 结果后检查 |
| `preFinalize` | 字符串数组，哪些 policy 名称在 finalize 前检查 |

---

## 六、Human-as-a-Tool（人工任务系统）

**核心 API：** `POST /api/messages`（Chat 端）、`POST /api/human-chat`（operater-agent 咨询）、`POST /api/human-tasks/[id]/resolve`（Console 端）

**通知机制（2026-04-30 更新）：事件驱动 + await+retry，无轮询。**
- resolve/route.ts: `notifyAgentResume()` 辅助函数，3 次重试 + 指数退避（500/1000/2000ms）
- human-chat/route.ts: `finalize_consultation` 后 await+retry 触发 `/api/messages`
- Chat page: SSE `consultation_complete` 事件直接通知，无需 polling

### 6.0 解释说明

> 可以这样理解 Human-as-a-Tool：
>
> **人工不是"接管对话"，而是 Agent 背后的一个可调用的资源。**
>
> 传统客服：转人工 → 用户重新描述问题 → 人工处理 → 结束
>
> 我们的设计：Agent 发现处理不了 → 发起人工任务 → **Agent 和人工直接对话** → 人工结束 → Agent 继续服务用户
>
> 用户始终面对同一个 Agent，但 Agent 可以在背后调动人工资源。

### 6.1 完整流程（演进方案）

**第一阶段：Agent 判断需要人工 → Loop 结束，顾客收到通知**

```
Case 处理中
    │
    │ LLM 判断需要人工介入
    ▼
create_human_task 被调用
    │
    ├──→ Case.status → waiting_human
    ├──→ 创建 HumanTask（开启一个"人工会话"）
    └──→ Loop 结束

前端收到 SSE：
    · case_status=waiting_human
    · assistant_text: "已转人工处理中，您可以继续提问或咨询其他问题"
    · Case 卡片高亮 waiting_human 状态
```

**第二阶段：Operator ↔ Agent 实时咨询对话（多轮，通过 human-chat API）**

```
人工在 /ops/human-tasks 看到待处理任务
    │
    ▼ 点击进入人工会话（/ops/human-tasks/[id]）
    │
    ├──→ 左侧：Case 摘要（facts / skills / memory）
    ├──→ 右侧：与 Agent 的咨询聊天界面（SSE 流式）
    └──→ 输入框：支持自然语言对话

人工消息 → POST /api/human-chat（SSE 流返回）
    │
    ▼ Agent 在 consultation 模式下运行
    ├──→ Agent 可调用 query_order_status / query_payment_channel_status 等工具
    ├──→ Agent 调用 finalize_consultation(summary, resolution) 结束咨询
    │     · summary: 面向顾客的消息
    │     · resolution: resolved / confirmed_delayed / refund_approved / false_alarm
    └──→ SSE consultation_complete 事件

人工可随时：
    · 发送自然语言与 Agent 对话
    · 点击 Close Case 按钮结束并通知顾客
    · 点击 Reopen 重新打开
```

**第三阶段：人工关闭 Case → Agent 通知顾客（事件驱动）**

```
人工点击 Close Case / 提交 resolve 表单
    │
    ▼ POST /api/human-tasks/[id]/resolve
HumanTask.status → resolved
Case.status → investigating（blocker 清空）
    │
    ▼ notifyAgentResume() — await + 3 次重试 + 指数退避
POST /api/messages（含 spec prompt）
    │
    ▼ Agent 生成顾客可见通知消息
    │
    ▼ 方式 A：通过 human-chat → finalize_consultation 触发
    │   方式 B：直接 resolve 触发
    │
    ▼ SSE consultation_complete → Chat page 显示过渡消息 → Agent 更新顾客 → 结案
```

### 6.2 内置 Skill：request_user_input

当 Agent 需要向顾客动态收集信息时，调用此 Skill：

```
Agent 调用 request_user_input
    │
    ├──→ skillInput: { formTemplate: string, fields: [...] }
    │
    ▼
前端 ChatPanel 实时渲染精美表单卡片
    │
    ├──→ 顾客在聊天框内填写
    └──→ 提交 → 作为 user message 入站 → Agent 继续推进
```

| 字段 | 说明 |
|---|---|
| `formTemplate` | 表单模板名称（如 `kyc_form`） |
| `fields` | 字段列表（如 `kyc_name` / `bank_account`） |
| `title` | 表单标题 |
| `description` | 填写说明 |

### 6.3 人工会话的结束方式

坐席处理完人工任务后，点击 **Close Case** 并填写内部备注。

**Close Case 触发 Agent Resume：**

```
坐席点击 Close Case → 填写内部 reason
    │
    ▼ POST /api/human-tasks/[id]/resolve
HumanTask.status → resolved
Case.status → investigating
    │
    ▼ 异步触发 resume
runAgentTurn({ resumeTrigger: taskId })
    │
    ├──→ synthetic message 包含：
    │    - 坐席填写的 verdict（如 "refund_approved"）
    │    - 坐席填写的 reason（内部备注）
    │    - 指令："请将此处理结果翻译成对顾客的通知消息"
    │
    ▼ Agent 恢复 ReAct Loop
Agent 生成顾客可见通知消息 → 发送给顾客
Case 状态保持 investigating（或由 Agent 自行 finalize）
```

**核心设计原则：**
- Close Case 的 reason 是**内部备注**，仅供运营复盘，不直接展示给顾客
- Agent 负责将 verdict + reason **翻译成顾客能理解的话术**，通过正常对话发送给顾客
- 顾客感知到的是：人工处理完了，Agent 发了一条友好的通知消息
- Case 可随时通过 **Reopen** 重新打开继续处理

**Reopen：** 任意时刻可点击，将 Case 状态恢复为 `investigating`，Agent 重新开始处理。Reopen 用于顾客补充信息或Case 需要重新评估的场景。

### 6.4 与旧设计的核心区别

| 旧设计 | 演进后 |
|---|---|
| 人工提交后直接结束 | 人工 Close Case 后 Agent 通知顾客，再结束 |
| 内部备注不转化为顾客通知 | Agent 将 reason 翻译成顾客话术 |
| Reopen 是特殊的 resume 路径 | Reopen = 字面意思，重新打开 case |
| Agent 不能主动推表单给顾客 | Agent 通过 request_user_input skill 主动推送表单卡片 |

---

## 七、Trace / 可观测性

**文件：** `lib/agent/trace.ts`

**Admin 配置：** 通过 `AgentConfig.memoryStrategy.maxRecentTraces` 控制注入 prompt 的 trace 条数上限

### 7.1 Trace 写入流程

```
Agent 运行全过程中
    │
    ├──→ 用户消息入站 ──────────→ writeTrace("user_message", ...)
    ├──→ 抽取用户事实 ──────────→ writeTrace("fact_extracted", ...)
    ├──→ Skill 调用前 ──────────→ writeTrace("skill_called", ...)
    ├──→ Skill 结果返回 ────────→ writeTrace("skill_result", ...)
    ├──→ Policy 命中 ───────────→ writeTrace("policy_hit", ...)
    ├──→ 人工任务创建 ──────────→ writeTrace("human_task_created", ...)
    ├──→ 人工回执完成 ──────────→ writeTrace("human_task_resolved", ...)
    ├──→ Case 闭环 ──────────────→ writeTrace("final_resolution", ...)
    └──→ Cron 触发 ──────────────→ writeTrace("cron_tick", ...)

所有 trace 写入 ActionTrace 表
    │
    ▼
前端通过 SSE 实时接收（type=trace 事件）
同时持久化到 DB，供 Case 卡片展开时展示
```

### 7.2 ActionType 枚举

| ActionType | 触发时机 |
|---|---|
| `user_message` | 用户消息入站 |
| `case_created` | Case 创建（由 Console API 写入） |
| `fact_extracted` | 从用户消息抽取事实（由 Console API 写入） |
| `policy_hit` | Policy 命中 |
| `skill_called` | Skill 调用前（种子数据使用） |
| `skill_result` | Skill 返回结果 |
| `human_task_created` | 人工任务创建 |
| `human_task_resolved` | 人工回执完成（由 Console API 写入） |
| `final_resolution` | Case 闭环 |
| `cron_tick` | Cron 触发（定时任务，预留） |
| `loop_decision` | Agent Loop 决策（压缩/跳过/重试） |
| `stream_event` | SSE 流式事件 |
| `llm_request_start` | LLM API 请求开始 |
| `llm_response` | LLM API 响应完成 |
| `microcompact` | MicroCompact 本地工具结果清理 |
| `stage_eval` | 阶段转换评估（含模型名） |
| `intent_classify` | 意图分类完成（含模型名） |

> **2026-05**: `stage_eval` / `intent_classify` / `policy_hit` / `llm_request_start` 均包含 `model` 字段，每个 Case trace 可追踪不同 agent（Core、意图分类、阶段评估、策略评估）使用的模型名。

### 7.3 Trace 存储

每条 trace 记录到 `ActionTrace` 表：
```typescript
ActionTrace {
  id: string
  caseId: string
  actionType: ActionType
  title: string
  detail?: string
  payload?: Json   // 附加数据（skill input/output 等）
  createdAt: DateTime
}
```

### 7.4 Trace 的展示

- **展示单位**：Case（不是全局的）
- **展示位置**：嵌入在展开的 case 卡片内部（CaseRail 点击展开后显示）
- **展示内容**：按 `createdAt` 倒序排列的操作时间线，每条含 title / detail / actionType 图标

---

## 八、Session / 多商户体系

**文件：** `lib/session-cookies.ts` + `lib/try-customer.ts`

### 8.1 Cookie 结构

| Cookie | 说明 | 示例 |
|---|---|---|
| `try_uid` | C 端 mock 用户 ID | `u_try_1` |
| `try_business` | 商户 ID | `vendor_a` |

### 8.2 Demo 用户槽位

| Slot | UserId | 说明 |
|---|---|---|
| 1 | `u_try_1` | Demo 用户 1 |
| 2 | `u_try_2` | Demo 用户 2 |
| ... | ... | ... |
| 5 | `u_try_5` | Demo 用户 5 |

每个用户对应隔离的 `Case` 数据，支持多用户并行演示。

---

## 九、数据库核心模型关系

```
DemoCustomer（B 端客户/厂商）
    │
    ├── AgentConfig（1:1）— Agent 编排配置
    ├── CaseSchema（1:N）— Case 类型定义
    ├── SkillRegistry（1:N）— Skill 注册表
    ├── PolicyConfig（1:N）— Policy 规则
    ├── Routing（1:N）— 人工路由配置
    └── Case（1:N）— 该客户的 Case
              │
              ├── CaseMemory（1:1）— Case 记忆
              ├── Message（N:1）— 消息记录
              ├── ActionTrace（N:1）— 操作追踪
              ├── SkillCall（N:1）— Skill 调用记录
              ├── HumanTask（N:1）— 人工任务
              └── PolicyHit（N:1）— Policy 命中记录
```

---

## 十、API 路由清单（更新于 2026-04-30）

### Chat App (port 3000)

| 路由 | 方法 | 职责 |
|---|---|---|
| `/api/messages` | POST | **消息入口**，触发 Agent Loop，SSE 流。加载 AgentConfig/Skills/Policies from DB。接受 `classification` 字段跳过二次分类 |
| `/api/human-chat` | POST | Operator-Agent 咨询对话，SSE 流。finalize_consultation 后 await+retry 通知顾客 |
| `/api/intent/classify` | POST | **意图分类**，轻量端点。前端先调用获取分类结果，再调 `/api/messages` |

### Console App (port 3001)

| 路由 | 方法 | 职责 |
|---|---|---|
| `/api/human-tasks` | GET | 人工任务列表 |
| `/api/human-tasks/[id]` | GET | 任务详情（含 Case + Memory + Traces） |
| `/api/human-tasks/[id]/resolve` | POST | 人工回执，await+retry 通知 Agent 恢复 |
| `/api/human-tasks/[id]/delete` | DELETE | Debug：删除任务及关联数据 |
| `/api/cases` | GET | Case 列表（?status=&limit=&offset=） |
| `/api/cases/[id]` | GET | Case 详情 + Memory + Tasks |
| `/api/cases/[id]/traces` | GET | Trace 时间线（?actionType=） |
| `/api/cases/[id]/messages` | GET | 对话记录 |
| `/api/cases/[id]/memory` | GET+PUT | 查看和编辑 Case Memory |
| `/api/admin/agent` | GET+PUT | Agent 配置 CRUD |
| `/api/admin/skills` + `/[name]` | CRUD | Skill 注册表 |
| `/api/admin/policies` + `/[name]` | CRUD | Policy 规则 |
| `/api/admin/case-types` + `/[name]` | CRUD | Case 类型定义 |
| `/api/admin/routing` + `/[name]` | CRUD | 人工路由队列 |

---

## 十一、前台页面清单（更新于 2026-04-30）

| 页面 | 路由 | 职责 |
|---|---|---|
| Chat 对话 | `/chat` | 顾客聊天界面，SSE 流式，Markdown 渲染 |
| 人工任务列表 | `/ops/human-tasks` | 展示待处理人工任务 |
| 人工任务处理 | `/ops/human-tasks/[id]` | Operator-Agent 咨询聊天 + case 上下文 |
| Case 详情 + Trace | `/ops/cases/[id]` | Trace 时间线（着色）+ 对话记录 |
| Case Memory | `/ops/cases/[id]/memory` | 左右栏 Memory 编辑器 |
| **Admin** | | |
| Agent 编排 | `/admin/agent` | System Prompt、Model、Policy Hooks |
| Skill 注册 | `/admin/skills` | 卡片列表 + 增删改 |
| Policy 规则 | `/admin/policies` | Hook 类型 badge + Rule JSON editor |
| Case 类型 | `/admin/case-types` | 状态机 stages 可视化 |
| 人工路由 | `/admin/routing` | 队列 priority + skills allowed |

---

## 十二、Admin 配置模块（在 /admin 页面展示）

根据代码，Admin 页面配置以下模块：

### 12.1 AgentConfig（Agent 编排）
- `systemPrompt` — 系统提示词
- `model` — 模型名称
- `maxIterations` — 最大迭代次数
- `temperature` — 温度参数
- `thinkingBudget` — 扩展思考 token 预算
- `memoryStrategy` — 记忆策略配置（含 keyEventExtractionPrompt）
- `policyHooks` — Policy hook 配置数组
- `toolParallelism` — 工具并行度

### 12.2 SkillRegistry（Skill 注册中心）
每个 skill 记录：
- name / description
- inputSchema / outputSchema（Anthropic tool 格式）
- mode（mock / http）
- endpoint / httpMethod / headers（http 模式）
- mockFixture（mock 默认样本）
- guardPhase（pre / post）
- enabled

### 12.3 PolicyConfig（Policy 规则）
- name / description
- rule（JSON，包含 deny_skills / require_skills / require_skills_any / evaluationPrompt 等参数，策略检查已从关键词匹配迁移到 LLM 评估）
- enabled

### 12.4 CaseSchema（Case 类型定义）— ★ 核心模块 ★
- type（如 `deposit_issue`）
- displayName / description
- requiredFacts（该类型 case 必需的字段列表，如 `txnId / amount / channel`）
- **stages（动态状态机数组）**— 这是本系统的核心配置，每个 case type 有自己的状态机，如：
  - `deposit_issue`：`["created", "collecting", "investigating", "waiting_human", "resolved"]`
  - `account_ban`：`["created", "investigating", "waiting_human", "escalated", "resolved"]`
- defaultGoal（该类型 case 的默认目标）
- icon（UI 图标）

**关键设计**：stages 由技术人员通过 Admin 后台配置，保存后下一次发起该类型 case 时生效。Case 的实际状态流转由 Agent 根据业务逻辑驱动。

### 12.5 Routing（人工路由）
- queue（如 `payment_ops` / `finance` / `risk_control`）
- description
- skillsAllowed（该队列允许的 skill 列表）

---

## 十三、Admin 后台配置（可视化配置面板）

参考 cc-switch 的设计理念，Admin 后台是一个可视化配置面板，技术人员可以通过 UI 直接配置 Agent 的各项参数，无需直接修改代码或数据库。

### 13.1 Admin 模块总览

Admin 后台按功能分为以下模块：

| 模块 | 说明 | 对应数据表 |
|---|---|---|
| **Agent 编排** | 配置 LLM 模型、system prompt、循环参数 | `AgentConfig` |
| **Skill 注册** | 管理 Skill 列表、模式、Mock fixture | `SkillRegistry` |
| **Policy 规则** | 配置安全策略、Guardrail 规则 | `PolicyConfig` |
| **Case 类型** | 定义 Case 类型、状态机、requiredFacts | `CaseSchema` |
| **人工路由** | 配置人工队列、技能权限 | `Routing` |
| **上下文压缩** | 配置各层 token 上限、注入策略 | `AgentConfig.memoryStrategy` |
| **厂商配置** | B 端厂商的 API 接入、认证信息 | `DemoCustomer` |

### 13.2 Agent 编排配置（AgentConfig）

**文件：** `lib/agent/llm.ts` + `loop.ts`

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `model` | string | `"claude-sonnet-4-20250514"` | LLM 模型名称 |
| `maxIterations` | number | `20` | 最大循环迭代次数 |
| `temperature` | number | `0.5` | 温度参数（0-1） |
| `thinkingBudget` | number | `4096` | 扩展思考 token 预算 |
| `systemPrompt` | string | — | 系统提示词模板 |
| `toolParallelism` | boolean | `true` | 是否启用工具并行执行 |
| `isConcurrencySafe` | boolean | `true` | 默认工具并发安全（可被 Skill 覆盖） |
| `policyHooks` | object | `{}` | Policy hook 配置（见下表） |
| `memoryStrategy` | object | `{}` | 记忆策略配置（见 13.2.1） |

**Policy Hooks 配置：**
```typescript
policyHooks: {
  preTool: string[],      // tool 调用前检查的 policy 名称列表
  postTool: string[],     // tool 结果后检查的 policy 名称列表
  preFinalize: string[],   // finalize 前检查的 policy 名称列表
}
```

### 13.2.1 上下文压缩配置（memoryStrategy）

**保留策略：**
| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `l1MaxMessages` | number | `12` | L1 最近消息条数上限 |
| `l2SummaryMaxTokens` | number | `2000` | L2 Case Memory 摘要 token 上限 |
| `l4MaxHistoricalCases` | number | `5` | L4 历史 Case 检索数量上限 |
| `keyEventExtractionPrompt` | string | — | LLM 抽取 keyEvents 的提示词 |
| `maxRecentTraces` | number | `20` | 注入 prompt 的最近 trace 条数上限 |
| `caseRetentionDays` | number | `90` | Case 记忆保留天数 |

**压缩阈值：**
| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `autocompactThresholdTokens` | number | `13000` | Autocompact 触发阈值 |
| `warningThresholdTokens` | number | `20000` | 警告阈值（纯提示，不触发压缩） |
| `errorThresholdTokens` | number | `20000` | 错误阈值 |
| `blockingThresholdTokens` | number | `3000` | 强制压缩硬截止（防上下文溢出） |

**压缩功能开关：**
| 配置项 | 类型 | 说明 |
|---|---|---|
| `enableSnip` | boolean | 是否启用消息裁剪 |
| `enableMicrocompact` | boolean | 是否启用工具结果清理 |
| `enableContextCollapse` | boolean | 是否启用上下文折叠 |
| `enableAutocompact` | boolean | 自动压缩总开关 |

**压缩微调：**
| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `compactModel` | string | — | 压缩摘要使用的模型 |
| `compactMaxMessages` | number | `40` | 压缩时发送的消息上限 |
| `compactTemperature` | number | `0.3` | 压缩 LLM temperature |
| `compactMaxTokensCap` | number | `4096` | 压缩 max_tokens 硬上限 |
| `compactMinSummaryLength` | number | `20` | 摘要最小字符数 |
| `compactionKeepMin` | number | `4` | 压缩后最少保留消息数 |
| `compactionKeepRatio` | number | `0.4` | 压缩后保留消息比例 |
| `compactableTools` | string[] | — | MicroCompact 可清理的工具名列表 |
| `compactPrompt` | string | — | 自定义压缩摘要 prompt（空=内置） |

**事实提取（LLM 驱动，已替代正则模式）：**
| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `factExtractionPrompt` | string | — | LLM 事实提取的额外提示词（可选） |
| `keyEventMaxChars` | number | `100` | KeyEvent 截断字符数 |

**Token 估算参数：**
| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `tokensPerKeyEvent` | number | `20` | 每个 keyEvent 估算 token |
| `tokensPerFact` | number | `15` | 每个 fact 估算 token |
| `tokensPerSkill` | number | `30` | 每个 skill 估算 token |
| `cjkCharPerToken` | number | `1.2` | CJK 字符/token 比 |
| `latinCharPerToken` | number | `3` | Latin 字符/token 比 |
| `minTokenEstimate` | number | `100` | 最小 token 估算 |
| `toolResultTokenRatio` | number | `3` | 工具结果 字符/token 比 |

### 13.3 Skill 注册配置（SkillRegistry）

**文件：** `lib/agent/skills.ts` + `mock-handlers.ts`

每个 Skill 的可配置项：

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `name` | string | — | Skill 唯一标识（Agent 调用时使用） |
| `description` | string | — | 描述（供 LLM 理解何时调用） |
| `inputSchema` | JSON Schema | `{}` | 输入参数 schema（Anthropic tool 格式） |
| `outputSchema` | JSON Schema | `{}` | 输出参数 schema |
| `mode` | enum | `"mock"` | 运行模式：`mock` 或 `http` |
| `endpoint` | string | — | HTTP endpoint（mode=http 时） |
| `httpMethod` | string | `"POST"` | HTTP 方法：GET / POST |
| `headers` | object | `{}` | 自定义请求头 |
| `timeoutMs` | number | `8000` | 超时时间（毫秒） |
| `mockFixture` | object | `{}` | Mock 默认样本（Admin 可视化编辑） |
| `guardPhase` | enum | `"post"` | 注册阶段：`pre`（仅注册）/ `post`（正常注册） |
| `isConcurrencySafe` | boolean | `true` | 是否可并行执行 |
| `enabled` | boolean | `true` | 是否启用 |

**内置 Skill 的默认 isConcurrencySafe：**
| Skill | isConcurrencySafe | 原因 |
|---|---|---|
| `read_case_history` | `true` | 只读操作 |
| `query_order_status` | `true` | 只读操作 |
| `query_payment_channel_status` | `true` | 只读操作 |
| `search_delay_notice` | `true` | 只读操作 |
| `ocr_receipt` | `true` | 只读操作 |
| `create_human_task` | `false` | 写操作，有副作用 |
| `finalize_case` | `false` | 写操作，有副作用 |
| `kb_hybrid_retrieve` | `true` | 只读操作 |

### 13.4 Policy 规则配置（PolicyConfig）

**文件：** `lib/agent/policy.ts`

每条 Policy 的可配置项：

| 配置项 | 类型 | 说明 |
|---|---|---|
| `name` | string | Policy 唯一标识 |
| `description` | string | 描述 |
| `hook` | enum | 执行点：`preTool` / `postTool` / `preFinalize` |
| `rule` | JSON | 规则对象（见下） |
| `enabled` | boolean | 是否启用 |

**Rule 规则结构：**
```typescript
rule: {
  deny_skills?: string[],           // 禁止调用的 skill 列表
  require_skills?: string[],        // 必须调用才能通过的 skill 列表
  require_skills_any?: string[],    // 至少调用其中之一的 skill 列表
  evaluationPrompt?: string,        // LLM 评估提示词（替代 deny_keywords/allow_keywords）
  min_evidence_count?: number,      // 最少证据数量
  evidence_sources?: string[],      // 证据来源类型
}
```

**内置 Policy 规则：**
| Policy Name | hook | 评估方式 | 说明 |
|---|---|---|---|
| `no_high_risk_account_change` | preTool | 精确名称匹配 | 拦截配置中的高危 skill |
| `conflict_requires_human` | postTool | LLM 评估 | 系统数据与用户申报矛盾时升级人工 |
| `evidence_required_before_resolution` | preFinalize | 精确名称匹配 | 未调用必要 skill 不得 finalize |
| `no_compensation_promise` | preFinalize | LLM 评估 | finalize 内容承诺赔偿 → blocked |
| `must_cite_basis` | preFinalize | LLM 评估 | finalize 必须引用证据来源 |
| `vip_care_softer_tone` | preFinalize | **[PLANNED]** VIP 场景柔软语气（未实现） |

### 13.5 Case 类型配置（CaseSchema）

**文件：** `lib/agent/loop.ts`（case 创建逻辑）

每个 Case Type 的可配置项：

| 配置项 | 类型 | 说明 |
|---|---|---|
| `type` | string | Case 类型唯一标识（如 `deposit_issue`） |
| `displayName` | string | 显示名称（如 "充值未到账"） |
| `description` | string | 描述 |
| `icon` | string | UI 图标（emoji 或图标名称） |
| `requiredFacts` | string[] | 该类型 case 必需的字段列表（如 `["txnId", "amount", "channel"]`） |
| `stages` | string[] | **动态状态机数组**（如 `["created", "collecting", "investigating", "waiting_human", "resolved"]`） |
| `defaultGoal` | string | 该类型 case 的默认目标描述 |
| `escalateOn` | string[] | 触发升级的关键词列表 |
| `autoCloseConditions` | JSON | 自动闭环条件（满足则 finalize） |

**stages 动态状态机示例：**
```yaml
# deposit_issue（充值问题）
stages: ["created", "collecting", "investigating", "waiting_human", "resolved"]

# account_ban（账号封禁）
stages: ["created", "investigating", "waiting_human", "escalated", "resolved"]

# refund_request（退款申请）
stages: ["created", "reviewing", "approved", "rejected", "resolved"]
```

### 13.6 人工路由配置（Routing）

| 配置项 | 类型 | 说明 |
|---|---|---|
| `queue` | string | 队列标识（如 `payment_ops` / `finance` / `risk_control`） |
| `description` | string | 队列描述 |
| `skillsAllowed` | string[] | 该队列允许的 skill 列表 |
| `priority` | number | 优先级（数字越小优先级越高） |
| `autoAssign` | boolean | 是否自动分配 |
| `maxWaitingTime` | number | 最大等待时间（秒） |

### 13.7 B 端厂商配置（DemoCustomer）

| 配置项 | 类型 | 说明 |
|---|---|---|
| `name` | string | 厂商名称 |
| `apiEndpoint` | string | API 接入点 |
| `apiKey` | string | API 密钥（加密存储） |
| `webhookUrl` | string | 回调 webhook URL |
| `allowedCaseTypes` | string[] | 允许的 Case 类型列表 |
| `customBranding` | JSON | 自定义品牌配置（logo / 主题色等） |

### 13.8 Admin UI 设计参考（cc-switch 风格）

参考 cc-switch 的配置面板设计，Admin 后台应具备以下 UI 特性：

**通用特性：**
- **左侧导航栏**：模块切换（Agent编排 / Skills / Policies / Case类型 / 人工路由 / 厂商配置）
- **右侧配置区**：表单式配置，支持 JSON Editor 高级模式
- **实时预览**：配置修改后实时显示对 system prompt 的影响
- **版本历史**：每次保存记录版本，支持回滚
- **导入/导出**：支持 JSON/YAML 格式导出配置，批量导入
- **测速/测试**：对 HTTP 模式的 Skill 支持在线测试

**cc-switch 设计亮点（需借鉴）：**
1. **分类清晰**：Provider 配置分组（基础信息 / 模型 / MCP / Skills / 高级）
2. **Tab 切换**：同类配置过多时用 Tab 分割
3. **折叠面板**：复杂配置用折叠面板收起，保持界面简洁
4. **拖拽排序**：Skill 列表、Policy 列表支持拖拽排序
5. **图标+颜色**：每个配置项有可视化的图标和颜色标识
6. **Badge 提示**：配置状态（启用/禁用/测试中）用 Badge 显示
7. **快捷操作**：批量启用/禁用、一键恢复默认

**配置面板布局示意：**
```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo] Intera Harness Admin           [搜索配置] [导入] [导出] │
├─────────┬───────────────────────────────────────────────────────┤
│         │  Agent 编排                                            │
│ ◉ Agent │  ─────────────────────────────────────────────────    │
│   Skills│                                                       │
│ ◉ Policies  Model:  [Claude Sonnet 4 ▼]  Temperature: [0.5]    │
│   Case  │                                                       │
│   Types │  System Prompt:                                       │
│ ◉ Human │  ┌─────────────────────────────────────────────┐   │
│   Rout. │  │ 你是一个专业的客服 Agent...                    │   │
│ ◉ Vendor│  └─────────────────────────────────────────────┘   │
│         │                                                       │
│         │  Loop Config:                                         │
│         │  ├─ maxIterations: [20]                             │
│         │  ├─ thinkingBudget: [4096]                          │
│         │  └─ toolParallelism: [✓]                            │
│         │                                                       │
│         │  Policy Hooks:                                       │
│         │  ├─ preTool: [no_high_risk] [+ 添加]                │
│         │  ├─ postTool: [conflict_requires_human]              │
│         │  └─ preFinalize: [must_cite_basis] [+ 添加]          │
│         │                                                       │
│         │                              [保存] [重置] [测试]    │
└─────────┴───────────────────────────────────────────────────────┘
```

---

## 十四、关键数据流：一条消息的完整旅程

```
1. 用户在 /chat 输入"我昨天充值了还没到账"
       │
2. ChatShell → POST /api/messages
       │
3. 写入 Message（role=user）
       │ 写入 ActionTrace（type=user_message）
       │
4. ingestUserMessageFacts()
       │ - 检测到"未到账"→ confirmedFacts.userReportedNotReceived=true
       │ - 尝试匹配订单号/金额
       │ - 更新 CaseMemory
       │
5. 检查 case.status === waiting_human？→ 否，继续
       │
6. 构造 systemPrompt = base + caseContext + memorySummary
       │
7. LLM 第一轮：
       │ - 检测到缺失 txnId → 追问用户
       │ - 用户补充订单号 TXU1_12345
       │
8. 第二轮 LLM：
       │ - 调用 query_order_status（txnId=TXU1_12345）
       │   → preTool policy 通过
       │   → mock 返回 { status: "pending" }
       │   → postTool policy 检测冲突（用户说未到账，但平台 pending）
       │   → 触发 conflict_requires_human → escalated
       │ - 调用 create_human_task
       │   → preTool 再次检查
       │   → mock 创建 HumanTask，status=pending
       │   → 更新 Case.status=waiting_human
       │
9. SSE 推送 human_task_created 前端高亮
       │
10. 用户在 /ops/human-tasks/[id] 提交回执
       │ verdict=confirmed_success / is_delayed_batch=true / expected_eta=2h
       │
11. POST /api/human-tasks/[id]/resolve
       │ - 更新 HumanTask.status=resolved
       │ - 更新 Case.status=investigating（blocker 清空）
       │ - 异步触发 runAgentTurn({ resumeTrigger })
       │
12. Agent Resume 第三轮：
       │ - synthetic user message 包含人工结论
       │ - 调用 finalize_case
       │   → preFinalize policy 检查 evidence + basis
       │   → 通过，写 Case.status=resolved
       │
13. SSE 推送 finalized，前端展示闭环结果
```

---

## 十五、现状分析与发展建议

### 15.1 当前认知与实际实现的偏差

经确认，以下几点需要更新：

1. **Case 状态机不是写死的 6 个状态**，而是每个 Case Type 有自己的动态状态机，由 `CaseSchema.stages` 定义，通过 Admin 后台配置，保存后下一次对话生效。这是核心预期。

2. **多 case 并行**：Demo 阶段暂定做 **B 方案**（同一用户同一时刻只有一个活跃 case，但 UI 上能看到所有 case 状态），后续可演进到 A 方案（多 case 同时跑独立 Agent Loop）。

3. **RAG**：确认现阶段是 mock，不实现真实 RAG。

4. **CaseSchema.stages 的结构**：stages 是动态配置的状态机，每个 case type 有自己的 stages 数组（如 `["created", "collecting", "investigating", "waiting_human", "resolved"]`），状态流转由 Agent 驱动。

### 15.2 项目有两套并行的 Agent 系统

| 路径 | 定位 | 与 Try Harness 的关系 |
|---|---|---|
| `/api/chat` + `lib/ai/` + `components/intera-chat.tsx` | **想法墙** — 团队头脑风暴工具（非产品本身） | 用于在设计讨论中将好点子发布到想法墙，与 Case 处理无关 |
| `/api/*` + `lib/agent/` | **Try Harness** — 真正的产品核心 | 完整的 Agentic 客服系统，含 Case / Skill / Policy / Human Task |

**重要澄清**：Intera 产品的核心是 Try Harness（Agentic Customer Service Harness），想法墙只是辅助团队做产品设计的工具，两者完全独立。

### 15.3 核心模块职责

| 文件 | 职责 |
|---|---|
| `loop.ts` | Agent Loop 入口，transition-driven 循环，StageExecutor 集成，Nudge 机制，StreamingToolExecutor 调度 |
| `stage-executor.ts` | **NEW** Stage-gated 执行引擎：阶段感知提示词构建、工具过滤、证据检查、阶段转换评估 |
| `orchestrator.ts` | **NEW** 编排器：案例类型识别、子Agent 派遣规划、并行调查调度 |
| `sub-agent.ts` | **NEW** 子Agent：隔离模型+提示词+技能集，独立运行调查任务 |
| `memory.ts` | Case Memory 维护，事实抽取，四层上下文注入 |
| `skills.ts` | Skill 路由分发，mock/http 双模式，StreamingToolExecutor 并行执行 |
| `policy.ts` | Policy 规则引擎，preTool/postTool/preFinalize 三个安检点 + 阶段级 guardrail 加载 |
| `mock-handlers.ts` | 内置 Skill 的 mock 实现，read_case_history / query_order_status 等 |
| `trace.ts` | 操作追踪写入，每步操作记录到 ActionTrace |
| `profiler.ts` | Query Profiler 检查点埋点，TTFT / latency 追踪 |

---

## 十六、Stage-Gated 执行引擎（2026-05-13 新增）

### 16.1 问题背景

原始 Agent Loop 存在以下健壮性问题：

1. **Loop 过早终止**：当 LLM 返回纯文本（无 tool_use）时，Loop 直接退出。如果 Agent 说"让我上报"但没有调用 `create_human_task`，Case 会卡住。
2. **阶段仅作建议**：CaseSchema 的 stages 仅注入 system prompt 作为文本指导，没有程序化执行。
3. **无阶段级护栏**：同一个 Policy 配置应用于所有阶段，无法区分"收集阶段"和"解决阶段"的行为边界。
4. **无子Agent派遣**：单一 Loop 处理一切，无法并行调查。

### 16.2 StageExecutor 引擎

**文件：** `lib/agent/stage-executor.ts`

StageExecutor 将阶段从"建议文本"升级为"可执行合约"：

```
Stage: collecting
  ├── requiredSkills: [request_user_input]    ← 必须调用的工具
  ├── availableSkills: [request_user_input]    ← 允许的工具白名单
  ├── evidenceRequirements: [                  ← 阶段完成条件
  │     { factKey: "txnId", source: "user_input" },
  │     { factKey: "amount", source: "user_input" },
  │   ]
  ├── guardrails: []                           ← 阶段级护栏
  └── transition: {                            ← 转换规则
        type: "auto",
        conditions: [{ type: "all_evidence_gathered" }]
      }
```

**三种转换类型：**
| 类型 | 说明 |
|---|---|
| `auto` | 条件满足即自动转换（如 all_evidence_gathered） |
| `evaluation` | 调用评估模型（轻量 Haiku）判断是否转换 |
| `manual` | 永不自动转换（如 waiting_human、resolved） |

### 16.3 Nudge 机制

当 LLM 返回文本但未调用阶段必需工具时：

```
LLM: "Let me escalate this to our specialist team."
     ↓ (no tool_use blocks)
StageExecutor.checkRequiredSkills("investigating")
     → { met: false, missing: ["create_human_task"] }
     ↓
Inject [SYSTEM NUDGE]:
  "Stage investigating requires: create_human_task.
   You MUST call these tools. Do not just describe
   what you will do — actually call the tools now."
     ↓
Continue loop (不退出！)
```

连续 3 次 Nudge 后升级为 human intervention（防止无限循环）。

### 16.4 阶段转换评估

```typescript
// Auto: 条件检查
StageExecutor.evaluateTransition("collecting")
  → checkEvidenceRequirements() → all met?
  → YES: shouldTransition=true, nextStage="investigating"

// Evaluation: LLM 判断
StageExecutor.evaluateTransition("investigating")
  → sends case facts + skill results to Haiku model
  → "System says success, user says not received → conflict"
  → shouldTransition=true, nextStage="waiting_human"
```

### 16.5 Per-Stage 模型与提示词

CaseSchema 的 `stageConfigs` 支持每个阶段独立配置：

```json
{
  "investigating": {
    "model": "claude-sonnet-4-20250514",
    "systemPrompt": "You are investigating a deposit issue...",
    "temperature": 0.3,
    "thinkingBudget": 8192
  }
}
```

未配置时回退到 AgentConfig 的默认模型和提示词。

---

## 十七、Sub-Agent 派遣系统（2026-05-13 新增）

### 17.1 架构

```
Agent Core (主脑)
   │ AgentConfig 配置
   │
   ├── 识别 Case Type → 加载 CaseSchema
   │
   ├── 进入 "investigating" 阶段
   │    │ stageConfig.investigating.subAgents = [
   │    │   { name: "order_investigator", skills: ["query_order_status"] },
   │    │   { name: "payment_investigator", skills: ["query_payment_channel_status"] }
   │    │ ]
   │    │
   │    ├── [并行] SubAgent: order_investigator
   │    │    ├── 模型: claude-haiku-4-5-20251001
   │    │    ├── 提示词: "Investigate order TXU1_12345..."
   │    │    └── 工具: [query_order_status]
   │    │
   │    └── [并行] SubAgent: payment_investigator
   │         ├── 模型: claude-haiku-4-5-20251001
   │         ├── 提示词: "Check payment channel status..."
   │         └── 工具: [query_payment_channel_status]
   │
   └── 合并结果 → CaseMemory → 主Agent 综合决策
```

### 17.2 核心文件

| 文件 | 职责 |
|---|---|
| `orchestrator.ts` | 派遣计划、并行/串行调度、非阻塞后台派发 (`dispatchInBackground`)、增量结果合并 (`mergeSingleResult`)、新结果轮询 (`hasNewResults`)**、统一通知格式 (`toNotification`)、上下文注入 (`toContextMessage`)** |
| `sub-agent.ts` | 隔离执行：独立 Anthropic 客户端、独立模型+提示词+技能集。**已去 mock**：通过 `StreamingToolExecutor.executeAll()` 真实执行工具。支持多轮 ReAct (`maxIterations`) 和流式进度 (`investigateStreaming`) |

### 17.3 配置

```json
// CaseSchema.orchestrator
{
  "enabled": true,
  "maxParallelAgents": 3,
  "dispatchPrompt": "Analyze and determine which sub-agents to dispatch."
}

// StageConfig.subAgents
[{
  "name": "order_investigator",
  "model": "claude-haiku-4-5-20251001",
  "systemPrompt": "You are an order investigator...",
  "skills": ["query_order_status"],
  "taskTemplate": "Investigate order for case {{caseId}}...",
  "maxIterations": 3,
  "parallel": true
}]
```

### 17.4 Sub-Agent 实例化与依赖注入（2026-05-13 更新）

SubAgent 通过 `SkillRouter` 获取真实的 `SkillDefinition[]`，不再使用硬编码 mock：

```typescript
// loop.ts — 构造函数
this.orchestrator = new OrchestratorAgent(deps.caseSchema, this.skillRouter.getToolDefinitions())

// orchestrator.ts — 传递给 SubAgent
agent = new SubAgent(task.agentConfig, this.skillDefinitions)
```

SubAgent 通过 `StreamingToolExecutor.executeAll()` 执行工具，与 Core Agent 共享相同的工具执行路径（mock / http 双模式）。

---

## 十八、智能意图路由与并行 Agent 系统（2026-05-13 新增）

### 18.1 问题背景

原始系统中，Case Type 由 URL 参数 (`?caseType=deposit_issue`) 或硬编码 `'general'` 决定。这意味着：

1. 顾客无法"随便开口" — 必须通过特定 URL 进入才能触发对应的 Case Type 流程
2. 没有自动意图识别 — 用户说"充值没到账"与"账号被封"在系统中无区别
3. Case 类型路由是手动的 — 无法从聊天内容自动分类并建案

### 18.2 架构概览

```
用户输入 "我的充值500元还没到账，交易号TX123456"
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  1) Intent Classification（意图分类）                          │
│  ─────────────────────────────────────────────────────────────  │
│  POST /api/intent/classify（轻量端点，前端先调用）               │
│    │                                                            │
│    ├── 加载该客户所有 enabled:true 的 CaseType 列表             │
│    ├── 调用轻量分类 LLM（默认 haiku）                           │
│    └── 返回意图分类结果：                                       │
│         · intent: "qa" | "case"                                │
│         · matchedCaseTypes[] (按置信度降序)                     │
│         · confidence / reasoning / extractedFacts              │
│         · needsClarification: 多匹配模糊时标记                   │
└─────────────────────────────────────────────────────────────────┘
    │
    ├─── intent=qa ───→ 纯聊天模式，无 Split，不建案
    │
    └─── intent=case ───→
            │
            ├── 高分明确匹配 → 自动建案 + Split 动画
            │     │
            │     ├── prisma.case.create({ type: matchedType })
            │     ├── SSE: case_created → 前端展示 Split 面板
            │     │
            │     └── AgentLoop 启动
            │           │
            │           ├── Orchestrator.dispatchInBackground()
            │           │     并行派发专职 Sub-Agent
            │           │
            │           └── Core Agent ReAct 循环
            │                 每轮检查 hasNewResults()
            │                 合并专职 Agent 结果到 CaseMemory
            │
            └── 多匹配模糊 → needsClarification=true
                  Core Agent 先追问用户，确认后再建案
```

### 18.3 核心文件

| 文件 | 职责 |
|------|------|
| `apps/chat/lib/agent/intent-classifier.ts` | 意图分类引擎：LLM 调用 → 匹配 CaseType → 智能追问逻辑 |
| `apps/chat/app/api/intent/classify/route.ts` | `POST /api/intent/classify` 轻量分类端点（非流式） |
| `apps/chat/lib/agent/config-cache.ts` | CaseType 列表缓存（30s TTL），通过 `config-changed` 失效 |

### 18.4 IntentClassification 数据结构

```typescript
interface IntentClassification {
  intent: 'qa' | 'case'
  matchedCaseTypes: Array<{
    type: string        // e.g. "deposit_issue"
    displayName: string // e.g. "充值未到账"
    icon: string        // e.g. "💰"
    confidence: number  // 0.0-1.0
  }>
  needsClarification: boolean
  reasoning: string
  extractedFacts: Record<string, string>  // { txnId: "TX123456", amount: "500" }
}
```

### 18.5 智能追问策略

| 条件 | 行为 |
|------|------|
| `topConfidence > 0.8` 且 `gap(1st, 2nd) > 0.3` | 高分明确 → 自动建案，不追问 |
| `topConfidence < 0.8` 或 `gap ≤ 0.3` | 模糊匹配 → `needsClarification=true`，Core Agent 先问用户 |
| 无匹配 CaseType | `intent: "qa"`，纯聊天，不建案 |
| 分类 LLM 超时（2s）或失败 | 降级为 `intent: "qa"` |

### 18.6 并行专职 Agent

**改进点：**
- **非阻塞派发**：`Orchestrator.dispatchInBackground()` 在后台运行，Core Agent ReAct 循环同时启动
- **增量合并**：每个专职 Agent 完成后立即通过 `mergeSingleResult()` 写入 CaseMemory
- **轮询检查**：Core Agent 每轮迭代开始时检查 `orchestrator.hasNewResults()` → 合并最新结果
- **统一通知格式（2026-05）**：`OrchestratorAgent.toNotification()` 将结果映射为 `SubAgentNotification`（CC `<task-notification>` 模式），前端 DedicatedAgentsPanel 统一消费
- **上下文注入（2026-05）**：子代理结果通过 `toContextMessage()` 注入 `this.messages`，主 agent 在下一轮 ReAct 迭代中可见子代理的 findings + recommendation + usage
- **SubAgent 去 mock**：接入 `StreamingToolExecutor` 真实执行工具，不再返回硬编码数据
- **多轮 ReAct**：SubAgent 支持 `maxIterations` 配置（默认 5），可以调用工具 → 获取结果 → 继续调用

### 18.7 新增 SSE 事件

| SSE 事件 | 触发时机 | 前端行为 |
|----------|----------|----------|
| `intent_classified` | 分类完成 | 决定是否展示 Split 动画 |
| `case_created` | 自动建案成功 | 创建 Case Tab，右面板滑入 |
| `sub_agent_start` | 专职 Agent 开始执行 | 显示 Agent 进度卡片（旋转状态） |
| `sub_agent_progress` | 专职 Agent 工具调用/思考中 | 更新卡片状态文本 |
| `sub_agent_complete` | 专职 Agent 完成 | 卡片变绿，展示发现详情 |
| `sub_agent_error` | 专职 Agent 超时/失败 | 卡片变红，展示错误信息 |

### 18.8 Chat UI 交互

| 功能 | 描述 |
|------|------|
| **Split 动画** | 单列聊天 → 水平双面板（左 Core 对话，右 Agent 进度）的 spring 动画过渡 |
| **Agent 进度卡片** | 右面板展示每个专职 Agent：状态图标（旋转/完成/错误）+ 耗时 + 可展开发现详情 |
| **折叠/展开** | 右面板可折叠为 48px 窄条（仅图标+状态点），点击展开查看详情 |
| **多 Case Tab** | 底部 Tab 栏切换多个活跃 Case，每个 Case 有独立的 Split 面板和 Agent 状态 |
| **不可打断** | 专职 Agent 运行中不接受用户中断，但用户可继续与 Core Agent 对话 |

### 18.9 配置点

| 配置项 | 位置 | 说明 |
|--------|------|------|
| `intentModel` | `AgentConfig` (Console → Agent 编排 → Model 段) | 分类用的模型，默认 haiku |
| CaseType `enabled` | `CaseType` (Console → Case 类型) | false = 不参与意图路由 |
| `orchestratorConfig.enabled` | CaseType 的 `orchestratorConfig` | 是否启用专职 Agent 派遣 |
| `subAgents[].maxIterations` | CaseType StageConfig 的 subAgents | 专职 Agent 最大轮次 |
| `subAgents[].model` | StageConfig 的 subAgents | 专职 Agent 模型 |

### 18.10 降级与容错

| 场景 | 行为 |
|------|------|
| 分类 LLM 超时（2s） | 降级为 `qa`，不阻塞对话 |
| 建案 DB 写入失败 | 继续 Agent Loop，用默认 caseId |
| 专职 Agent 30s 超时 | 发 `sub_agent_error`，Core Agent 告知用户部分结果 |
| 快速连发两条消息触发建案 | 使用第一条消息已建的 caseId，不重复创建 |
| CaseType 缓存过期（30s） | 自动从 DB 重新加载 |

---

