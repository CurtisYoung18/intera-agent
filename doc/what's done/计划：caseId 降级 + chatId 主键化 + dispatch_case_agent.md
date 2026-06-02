Ready for review
Select text to add comments on the plan
计划：caseId 降级 + chatId 主键化 + dispatch_case_agent
Context
当前 chatId（会话分组字段）和 caseId（工单调查标识）关系混乱：

Case.chatId 可空，导致到处 OR: [{chatId}, {id:chatId}] 兜底
create_case 触发主 Agent 模式切换（Core→Case），Agent 从对话模式变为调查模式
每个 stage 可以 dispatch 多个 sub-agent，stage transition 用 LLM 评估
ChatMemory 1:1 绑 caseId，没有 chat 级别内存
目标架构：

chatId 是唯一会话标识，一个 chat = 一个主 AgentLoop（始终对话模式）
dispatch_case_agent spawn 后台 case agent（处理该 case 的全部 stage），主 Agent 不受影响
Stage config 保留（工具过滤 + nudge prompt），去除 per-stage sub-agent dispatch 和 LLM stage transition eval
新建 ChatSession 表存 chat 级别内存，ChatMemory 继续 1:1 绑 caseId
Skill.toolCategory 字段区分系统信息工具 / 操作工具，Console 可开关
Phase 1：数据模型清理（低风险）
Step 1.1：Skill 表加 toolCategory 字段
Schema 改动 (packages/shared/prisma/schema.prisma)：

model Skill {
  // ...existing fields...
  toolCategory  String?  // 'system_info' | 'operational' | null
}
分类规则：

system_info：read_chat_memory、read_user_profile、read_case_history、get_current_time、kb_search_*、search_delay_notice
operational：query_order_status、query_payment_channel_status、get_account_status、get_kyc_status、get_transaction_history、get_active_promotions、get_eligible_promotions、get_latest_withdrawal、get_withdraw_conditions、ocr_receipt、dispatch_case_agent、create_human_task、finalize_case、request_user_input、propose_interaction、propose_cases、dispatch_subagent、todo_write、todo_read、finalize_sub_agent
文件改动：

packages/shared/prisma/schema.prisma：加字段
packages/shared/types/index.ts：SkillDefinition 加 toolCategory?: 'system_info' | 'operational'
apps/chat/lib/agent/skills.ts：SkillRouter.create() 加载 DB skill 时读 toolCategory；内置 skill 标记类别
apps/console/app/admin/tools/page.tsx：加 toolCategory 选择器
Step 1.2：新建 ChatSession 表
Schema (packages/shared/prisma/schema.prisma)：

model ChatSession {
  id        String   @id @default(cuid())
  chatId    String   @unique
  orgId     String   @map("org_id") @default("default")
  confirmedFacts String @default("{}")
  summary   String?
  keyEvents String   @default("[]")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("chat_sessions")
}
文件改动：

packages/shared/prisma/schema.prisma：新增 model
apps/chat/lib/agent/memory.ts：新增 ChatSessionManager 类
Step 1.3：Case.chatId 数据回填 + 改非空
回填脚本（一次性 SQL）：

-- 从 ActionTrace 恢复 chatId
UPDATE cases SET "chatId" = (
  SELECT "chatId" FROM action_traces
  WHERE "caseId" = cases.id AND "chatId" IS NOT NULL
  ORDER BY "createdAt" DESC LIMIT 1
) WHERE "chatId" IS NULL;

-- 剩余生成 UUID
UPDATE cases SET "chatId" = gen_random_uuid()::text WHERE "chatId" IS NULL;
Prisma schema：chatId String? → chatId String（去掉 ?）

代码改动：全局替换 chatId ?? null → chatId

Step 1.4：消除 OR: [{chatId}, {id:chatId}] 兜底
文件改动：

apps/chat/app/api/cases/route.ts：OR: [{ chatId }, { chatId: null }] → { chatId }
apps/chat/app/api/internal/compact-chat/route.ts：OR: [{ chatId }, { id: chatId }] → { chatId }
apps/console/app/api/chats/[chatId]/memory/route.ts：同上
apps/console/app/api/chats/[chatId]/update-profile/route.ts：同上
apps/console/app/api/chats/[chatId]/route.ts：去掉 fallback 到 { id: chatId }
Phase 2：行为重构（高风险）
Step 2.1：create_case → dispatch_case_agent 全局改名
文件改动：

apps/chat/lib/agent/skills.ts：内置 skill 定义改名，更新 description/inputSchema
apps/chat/lib/agent/conversation-loop.ts：CORE_ALLOWED_TOOLS 里的 create_case → dispatch_case_agent
apps/chat/lib/agent/stage-executor.ts：filterTools() 里的排除条件
apps/chat/lib/agent/case-agent-loop.ts：filterSopTools() 里的排除集合
apps/chat/lib/agent/loop.ts：所有 'create_case' 字符串引用 + 处理逻辑
packages/shared/defaults/index.ts：prompt 模板中的工具名引用
所有测试 fixture 中的引用
Step 2.2：AgentLoop 去掉 Core/Case 模式切换
核心改动 (apps/chat/lib/agent/loop.ts)：

移除 isCaseActive 判断（line 375）：主 Agent 始终处于对话模式
dispatch_case_agent 处理逻辑重写（替换 lines 1237-1364）：
检测到 dispatch_case_agent tool result →
查 DB 获取 CaseType，构建 CaseSchemaConfig
创建 Case 记录（带 chatId）
创建 ChatMemory
构建 case agent 的 SubAgentTask（负责该 case 的全部 stage）
orchestrator.dispatchInBackground([task]) 后台运行
emit case_created SSE event
替换 mock result 为真实 caseId
continue（不切换模式）
移除 startDedicatedAgents() 调用（line 296）
移除 Consultation 模式特殊处理（lines 450-463）：主 Agent 始终有全套对话工具
移除 caseLoop?.isStageActive() gating（line 375 及相关）
涉及文件：

apps/chat/lib/agent/loop.ts：主要改动
apps/chat/lib/agent/case-agent-loop.ts：保留但仅被 case agent 内部使用（不再是主 Agent 的模式切换目标）
apps/chat/lib/agent/memory.ts：ChatSessionManager 集成到主 Agent
Step 2.3：移除 per-stage sub-agent dispatch
文件改动：

apps/chat/lib/agent/case-agent-loop.ts：
startDedicatedAgents() → 变为空操作或移除
applyStageTransitionFromEval() → 移除 sub-agent dispatch 代码块（lines 847-880），只保留 stage 更新 + guardrail 加载
apps/chat/lib/agent/loop.ts：
移除 line 296 的 startDedicatedAgents() 调用
processDispatchSubagent() 保留（CC 模式显式 dispatch_subagent 工具调用仍可用）
Step 2.4：移除 LLM-based stage transition evaluation
文件改动：

apps/chat/lib/agent/stage-executor.ts：
移除 evaluateTransition() 和 runEvaluation() 方法
或标记为 deprecated（保留代码不调用）
apps/chat/lib/agent/case-agent-loop.ts：
evaluateStageTransitionAfterNoTools() → 简化为纯规则检查（checkRequiredSkills + checkEvidenceRequirements）
handleCaseTerminalTools() 中的 evaluateTransition() → 替换为简单 auto transition
packages/shared/types/index.ts：TransitionEval 去掉 modelUsed 字段
Step 2.5：ChatSession 表写入 chat 级别内存
文件改动：

apps/chat/lib/agent/memory.ts：新增 ChatSessionManager 类
apps/chat/lib/agent/loop.ts：
run() 开始时 load/create ChatSession
每轮迭代后 persist 主对话 facts
compaction 时写入 ChatSession.summary
apps/chat/lib/agent/compact.ts：compaction 结果写入 ChatSession
apps/console/app/api/chats/[chatId]/memory/route.ts：同时返回 ChatSession + ChatMemory 数据
Step 2.6：Console 工具分类开关
文件改动：

apps/console/app/admin/agent/page.tsx：加 "Tool Categories" 区域，按 toolCategory 分组显示，开关 per-category
apps/chat/lib/agent/skills.ts：SkillRouter 新增 filterByCategory() 方法，根据 channel config 过滤
apps/chat/lib/agent/loop.ts：构建 tools 时应用 toolCategory 过滤
向后兼容
需要保留的现有机制
executionMode: 'stage' 和 'cc' 双模式 → 保留，case agent 内部仍可选择
Stage configs 的 availableSkills / requiredSkills → 保留，用于 case agent 内部工具过滤
Policy hooks（preTool / postTool / preFinalize）→ 保留，不变
dispatch_subagent 工具 → 保留，CC 模式下 case agent 可显式调用来分派子任务
OrchestratorAgent → 保留，用于 dispatch case agent 和 dispatch_subagent
需要移除的机制
主 Agent 的 Core/Case 模式切换 → 移除
Per-stage sub-agent 自动 dispatch → 移除
LLM-based stage transition evaluation → 移除
OR: [{chatId}, {id:chatId}] 兜底 → 移除
验证
数据库：npx prisma db push 无报错；回填脚本运行后 SELECT count(*) FROM cases WHERE "chatId" IS NULL = 0
单元测试：npx vitest run 全部通过
手动测试：
Web Chat：发消息 → Agent 对话回复 → 触发 dispatch_case_agent → case agent 后台运行 → 结果显示在对话中
多 case：同一 chat 发多条不同类型消息 → 多个 case agent 并行运行
Console：Memory 标签能看到 ChatSession 数据；工具分类开关生效
LiveChat：bridge 流程正常（chatId = LiveChat external ID 的语义不受影响）