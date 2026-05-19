# Intera Agent — 系统时序图

> 基于 Intera Harness 架构文档 v1.1 (2026-05-13) 与核心代码库。
> 所有参与者名称、方法调用、SSE 事件类型均与实际代码一致。

---

## 图例

| 约定 | 含义 |
|------|------|
| `→` | 同步调用 / HTTP 请求 |
| `--→` | 异步通知 / SSE 推送 |
| `Note right of` | 关键决策点 / 边界条件 |
| `activate/deactivate` | 对象生命周期 |
| `alt/else` | 分支逻辑 |
| `par` | 并行执行 |

**SSE 事件类型前缀**：所有以 `evt:` 开头的内容对应实际 `SSEEvent.type` 枚举值。

---

## 1. 消息全链路流程 (Message Full Lifecycle)

用户从输入消息到获得 Agent 响应的端到端流程。**路由由 Core Agent 自行决定**：通过 `propose_cases`（多意图澄清）和 `create_case`（直接建案）两个内置工具，Agent 判断是纯 QA 对话还是需要创建 Case 并派遣子Agent调查。


```mermaid
sequenceDiagram
    participant User as 👤 User
    participant ChatUI as Chat UI<br/>(useInteraChat)
    participant MsgAPI as POST /api/messages
    participant Cache as ConfigCache<br/>(30s TTL)
    participant DB as PrismaDB<br/>(SQLite/PostgreSQL)
    participant Prompt as PromptResolver
    participant Agent as AgentLoop<br/>(loop.ts)
    participant LLM as Anthropic API<br/>(MiniMax-M2.7)

    User->>ChatUI: 输入消息 "充值500元还没到账"


    ChatUI->>MsgAPI: POST { message, customerId, userId, caseId? }
    MsgAPI->>Cache: getCachedConfig(customerId)
    alt cache miss
        Cache->>DB: SELECT AgentConfig WHERE customerId
        DB-->>Cache: AgentConfig
    end
    Cache-->>MsgAPI: AgentConfigData

    MsgAPI->>Prompt: resolvePrompt(systemPrompt, context)
    Note right of Prompt: 替换占位符:<br/>{{case_types}} {{case_schema}}<br/>{{case_state}} {{active_policies}}<br/>{{session_binding}}

    MsgAPI->>DB: upsert Case + CaseMemory
    DB-->>MsgAPI: Case, CaseMemory

    MsgAPI->>Agent: new AgentLoop(deps)
    MsgAPI->>Agent: run(userMessage, sendSSE)
    activate Agent

    Agent->>LLM: ingestUserMessageFacts(message)
    LLM-->>Agent: { extractedFacts, flags }

    Note over Agent: ═══ Core Agent 自主路由 ═══<br/>Agent 内置 propose_cases / create_case 工具<br/>LLM 根据用户意图自行决定调用哪个

    loop ReAct Loop (max 20 iterations)
        Agent->>Agent: 上下文压缩 (microCompact/autoCompact)
        Agent->>LLM: anthropic.messages.stream()
        LLM-->>ChatUI: evt: stream_request_start

        loop 流式生成
            LLM-->>ChatUI: evt: thinking_delta
            LLM-->>ChatUI: evt: text_delta
            LLM-->>Agent: tool_use block (content_block_stop)
            Agent-->>ChatUI: evt: tool_executing
            Agent->>Agent: executeSkill() + Policy checks
            Agent-->>ChatUI: evt: skill_result
        end

        Agent->>Agent: StageExecutor.evaluateTransition()
        Agent-->>ChatUI: evt: memory_update / case_status

        alt 纯文本 (无 tool_use) — QA/FAQ 模式
            Agent->>Agent: break → 退出循环
        else propose_cases — 多意图澄清
            Agent-->>ChatUI: evt: clarification (多选卡片)
            Agent->>Agent: break → awaiting_clarification
            Note right of Agent: 用户选择后重新进入<br/>此时 create_case 被调用
        else create_case — 建案 + 派遣子Agent
            Agent->>DB: INSERT Case (type=matchedCaseType)
            Agent-->>ChatUI: evt: case_created
            Agent->>Agent: orchestrator.dispatchInBackground()
            Note right of Agent: 建案后根据阶段配置<br/>并行派遣专职调查子Agent
        else create_human_task
            Agent-->>ChatUI: evt: human_task_created
            Agent->>Agent: break → waiting_human
        else finalize_case
            Agent-->>ChatUI: evt: finalized
            Agent->>Agent: break → resolved
        end
    end

    Agent->>DB: persist CaseMemory + Messages + ActionTrace
    deactivate Agent
    Agent-->>MsgAPI: AgentResult { transition, caseStatus }
    MsgAPI-->>ChatUI: evt: message_stop

    ChatUI->>ChatUI: render 最终消息 + 更新 Case 卡片
```

---

## 2. Agent ReAct Loop 内部机制

AgentLoop 单次迭代的完整内部流程，展示阶段门控、工具执行、策略检查和上下文压缩的协作。

```mermaid
sequenceDiagram
    participant Agent as AgentLoop<br/>(loop.ts)
    participant Memory as CaseMemoryManager<br/>(memory.ts)
    participant StageEx as StageExecutor<br/>(stage-executor.ts)
    participant LLM as Anthropic API
    participant ToolEx as StreamingToolExecutor<br/>(streaming-tool-executor.ts)
    participant Policy as PolicyEngine<br/>(policy.ts)
    participant Skills as SkillRouter<br/>(skills.ts)
    participant Trace as TraceWriter<br/>(trace.ts)
    participant Orch as OrchestratorAgent<br/>(orchestrator.ts)
    participant DB as PrismaDB

    Note over Agent: runAgentTurn() 入口

    rect rgb(245, 245, 250)
        Note over Agent,Trace: 1) 上下文压缩阶段
        Agent->>Memory: microCompact(messages, minAgeMs=60s)
        Note right of Memory: 清理旧 tool_result<br/>保护新鲜缓存
        Agent->>Memory: sessionMemoryCompact()
        Memory-->>Agent: { shouldCompact, isBlocking }
        alt token > 40K (autocompact threshold)
            Agent->>LLM: compactConversation(messages)
            LLM-->>Agent: summary
            Memory->>Memory: 更新 L2 summary
        end
        alt token > 15K (blocking threshold)
            Agent->>Memory: snip(messages, keepRatio=0.65, keepMin=6)
        end
    end

    rect rgb(250, 245, 240)
        Note over Agent,Trace: 2) 用户消息写入
        Agent->>Memory: writeMessage(role=user)
        Agent->>Trace: writeTrace("user_message")
    end

    rect rgb(240, 250, 245)
        Note over Agent,Trace: 3) 事实提取
        Agent->>LLM: ingestUserMessageFacts(message)
        Note right of LLM: 调用 extract_facts 工具<br/>提取 txnId, amount, flags 等
        LLM-->>Memory: { extractedFacts, flags }
        Memory->>Memory: merge confirmedFacts<br/>remove from missingFacts
    end

    alt case.status === waiting_human
        Agent->>Agent: 发送通知，暂停，不进入 Agent
    end

    rect rgb(255, 250, 240)
        Note over Agent,Orch: 4) 子 Agent 派遣（首次进入阶段时）
        opt orchestrator.enabled && first iteration
            Agent->>StageEx: getStageConfig(currentStage)
            StageEx-->>Agent: { subAgents, requiredSkills, ... }
            Agent->>Orch: planInvestigation(stage, subAgentConfigs, memory)
            Orch-->>Agent: SubAgentTask[]
            Agent->>Orch: dispatchInBackground(tasks)
            Note right of Orch: 后台并行执行<br/>不阻塞主 Agent
        end
    end

    rect rgb(240, 245, 255)
        Note over Agent,LLM: 5) Transition-Driven ReAct Loop
        loop while iterationCount < maxIterations
            Agent->>StageEx: buildStagePrompt(currentStage, memory)
            StageEx-->>Agent: stageContextBlock
            Note right of StageEx: 注入阶段目标、证据要求<br/>已调用技能、缺失事实

            Agent->>StageEx: filterTools(currentStage, allTools)
            StageEx-->>Agent: allowedTools
            Note right of StageEx: 按阶段白名单过滤<br/>仅暴露当前阶段允许的工具

            Agent->>ToolEx: new StreamingToolExecutor(allowedTools)
            Agent->>LLM: anthropic.messages.stream({ system, messages, tools })

            par LLM 流式生成 + 工具即时执行
                loop 每个 content block
                    alt text_delta
                        LLM-->>Agent: SSE: text_delta
                    else thinking_delta
                        LLM-->>Agent: SSE: thinking_delta
                    else tool_use (content_block_stop)
                        LLM-->>ToolEx: enqueue(toolUse)
                        ToolEx->>ToolEx: updateStatus(queued)
                        alt isConcurrencySafe=true
                            ToolEx->>ToolEx: 加入并行队列 → 立即执行
                        else isConcurrencySafe=false
                            ToolEx->>ToolEx: 加入串行队列 → 等待排他锁
                        end
                    end
                end
            end

            ToolEx->>ToolEx: waitForAll()
            Note right of ToolEx: 等待所有入队工具完成<br/>并行工具 Promise.all<br/>串行工具逐一出队

            rect rgb(255, 240, 240)
                Note over ToolEx,Policy: 6) 每个工具结果的后处理
                loop 每个 completed tool
                    ToolEx->>Policy: evaluatePreTool(skillName)
                    Note right of Policy: deny_skills 精确匹配<br/>require_skills 前置检查
                    alt blocked
                        Policy-->>ToolEx: { result: "blocked", reason }
                    else pass
                        ToolEx->>Skills: runSkill(name, input)
                        Skills-->>ToolEx: SkillRunResult { ok, output, latencyMs }
                        ToolEx->>Memory: applySkillResultToMemory(output)
                        Memory->>Memory: merge confirmedFacts<br/>add to skillsCalled
                        ToolEx->>Policy: evaluatePostTool(skillOutput)
                        Note right of Policy: 批量 LLM 评估<br/>单次 API 调用覆盖所有结果
                        Policy-->>ToolEx: { result: "pass"|"hint"|"blocked"|"escalated" }
                        ToolEx->>Trace: writeTrace("skill_result")
                    end
                end
            end

            rect rgb(250, 240, 255)
                Note over Agent,StageEx: 7) 终端工具处理
                alt create_human_task
                    Agent->>DB: 创建 HumanTask, Case→waiting_human
                    Agent-->>Agent: break (transition: waiting_human)
                else finalize_case
                    Agent->>Policy: evaluatePreFinalize(facts, basis)
                    Policy-->>Agent: { result, reason }
                    opt preFinalize blocked
                        Agent->>Agent: continue (不退出, Nudge LLM)
                    end
                    Agent->>DB: Case→resolved
                    Agent-->>Agent: break (transition: resolved)
                else request_user_input
                    Agent-->>Agent: break (transition: waiting_form)
                else propose_cases
                    Agent-->>Agent: break (transition: awaiting_clarification)
                else propose_interaction
                    Agent-->>Agent: break (transition: awaiting_interaction)
                end
            end

            rect rgb(240, 250, 240)
                Note over Agent,StageEx: 8) 阶段转换评估
                Agent->>StageEx: evaluateTransition(currentStage, memory, skillResults)
                alt transition type = auto
                    StageEx->>StageEx: checkEvidenceRequirements()
                    alt all_evidence_gathered + all_skills_called
                        StageEx-->>Agent: { shouldTransition: true, nextStage }
                        Agent-->>Agent: SSE: case_status
                    end
                else transition type = evaluation
                    StageEx->>LLM: stage_transition_decision tool_use
                    Note right of LLM: Assistant pre-fill `{"` 强制 JSON<br/>3次解析失败 → 断路器降级
                    LLM-->>StageEx: { shouldTransition, nextStage, reason }
                    StageEx-->>Agent: TransitionEval
                else transition type = manual
                    StageEx-->>Agent: { shouldTransition: false }
                    Note right of StageEx: 仅人工触发<br/>(waiting_human/resolved)
                end
            end

            rect rgb(255, 250, 245)
                Note over Agent,StageEx: 9) Nudge 检查
                Agent->>StageEx: checkRequiredSkills(currentStage, skillsCalled)
                alt 缺失必需技能
                    StageEx-->>Agent: { met: false, missing: [...] }
                    alt nudgeCount < 3
                        Agent->>Agent: 注入 [SYSTEM NUDGE] 到下一轮
                        Note right of Agent: "You MUST call these tools.<br/>Do not just describe — call them."
                    else nudgeCount >= 3
                        Agent->>Agent: 升级为 human intervention
                    end
                end
            end

            alt LLM 返回纯文本 (无 tool_use)
                opt requiredSkills 已满足
                    Agent-->>Agent: break (正常结束)
                end
            end

            Agent->>Orch: hasNewResults()
            alt 有新结果
                Orch-->>Agent: SubAgentResult[]
                Agent->>Memory: merge sub-agent findings
            end
        end
    end
```

---

## 3. Skill 执行与 Policy 检查流程

单个 Skill 从 LLM 决定调用到完成结果回写的详细流程，展示并行/串行执行、Mock/HTTP 双模式和双重 Zod 校验。

```mermaid
sequenceDiagram
    participant LLM as Anthropic API
    participant ToolEx as StreamingToolExecutor
    participant Policy as PolicyEngine<br/>(policy.ts)
    participant Skills as SkillRouter<br/>(skills.ts)
    participant Mock as MockHandler
    participant External as External HTTP API
    participant Memory as CaseMemoryManager
    participant ChatUI as Chat UI (SSE)

    Note over LLM: tool_use block 在 stream 中<br/>content_block_stop 事件触发

    LLM->>ToolEx: enqueue({ name: "query_order_status", input: { txnId: "TX123" } })
    ToolEx->>ToolEx: updateStatus("queued")

    Note over ToolEx: 一阶段 Zod 校验 (enqueue 时)
    ToolEx->>Skills: getToolDefinition("query_order_status")
    Skills-->>ToolEx: SkillDefinition { inputSchema, isConcurrencySafe }

    ToolEx->>ToolEx: ZodSchema.parse(input)
    Note right of ToolEx: 校验失败 → 立即标记 error<br/>不进入执行流程

    alt isConcurrencySafe = true
        ToolEx->>ToolEx: 加入并行池 → 立即启动
        Note right of ToolEx: 与其他 read-only 工具<br/>通过 Promise.all 并发
    else isConcurrencySafe = false
        ToolEx->>ToolEx: 获取排他锁 → 串行执行
        Note right of ToolEx: 等待所有并行工具完成<br/>阻塞后续工具入队
    end

    ToolEx->>ToolEx: updateStatus("executing")
    ToolEx-->>ChatUI: evt: tool_executing { toolName, input }

    rect rgb(255, 245, 240)
        Note over ToolEx,Policy: preTool Policy 检查
        ToolEx->>Policy: evaluatePreTool("query_order_status", input)

        alt deny_skills 精确匹配
            Policy-->>ToolEx: { result: "blocked", reason: "高危操作被拦截" }
            ToolEx->>ToolEx: updateStatus("error")
            ToolEx-->>ChatUI: evt: skill_result { error: "blocked by policy" }
        else require_skills 前置条件检查
            alt 前置 Skill 未调用
                Policy-->>ToolEx: { result: "blocked", reason: "需先调用 query_order_status" }
                ToolEx->>ToolEx: updateStatus("error")
            else 前置 Skill 已满足
                Policy-->>ToolEx: { result: "pass" }
            end
        else 无匹配规则
            Policy-->>ToolEx: { result: "pass" }
        end
    end

    rect rgb(240, 250, 245)
        Note over ToolEx,External: Skill 路由分发
        alt result is "pass"
            ToolEx->>Skills: runSkill("query_order_status", { txnId })

            alt mode = "mock"
                Skills->>Mock: runMockQueryOrderStatus(input)
                Note right of Mock: 读取 demo_mock_order 表<br/>返回预设 fixture 数据<br/>模拟随机延迟 200-800ms
                Mock-->>Skills: { status: "completed", amount: 500 }
            else mode = "http"
                Skills->>External: POST endpoint { caseId, input }
                Note right of External: 携带自定义请求头<br/>超时: timeoutMs (默认 8s)
                alt 成功
                    External-->>Skills: { status: "ok", data }
                else 超时/错误
                    External-->>Skills: { status: "error", message }
                end
            end

            Skills-->>ToolEx: SkillRunResult { ok, status, output, latencyMs, mode }
            Note over ToolEx: 二阶段 Zod 校验 (output schema)
            ToolEx->>ToolEx: ZodSchema.parse(output)
        end
    end

    rect rgb(245, 240, 255)
        Note over ToolEx,Memory: 结果写入 Memory
        ToolEx->>Memory: applySkillResultToMemory(skillName, output)
        Memory->>Memory: merge output → confirmedFacts
        Memory->>Memory: push skillName → skillsCalled
        Memory->>Memory: remove matched → missingFacts
    end

    rect rgb(255, 250, 240)
        Note over ToolEx,Policy: postTool Policy 检查（批量 LLM 评估）
        Note right of Policy: 本轮所有 tool results<br/>单次 API 调用批量评估
        ToolEx->>Policy: evaluatePostTool(skillOutput)
        Policy->>LLM: evaluate_policy 工具调用<br/>(含所有 tool result 上下文)
        LLM-->>Policy: { result, reason }
        alt result = "escalated"
            Policy-->>ToolEx: { result: "escalated", reason: "系统数据与用户申报冲突" }
            Note right of ToolEx: 触发 conflict_requires_human<br/>后续 Agent 应调用 create_human_task
        else result = "hint"
            Policy-->>ToolEx: { result: "hint", reason: "有风险，标记但不阻止" }
        else result = "pass"
            Policy-->>ToolEx: { result: "pass" }
        end
    end

    ToolEx->>ToolEx: updateStatus("completed")
    ToolEx-->>ChatUI: evt: skill_result { skillName, output, latencyMs }
```

---

## 4. Human-as-a-Tool 完整流程

人工不是"接管对话"，而是 Agent 背后的一个可调用资源。此图展示从 Agent 决定升级、Operation-Agent 咨询、到人工回执后 Agent 恢复并通知顾客的完整闭环。

```mermaid
sequenceDiagram
    participant User as 👤 Customer
    participant ChatUI as Chat UI
    participant MsgAPI as /api/messages
    participant Agent as AgentLoop
    participant DB as PrismaDB
    participant ConsoleUI as Console UI<br/>/ops/human-tasks
    participant Operator as 👩‍💻 Operator
    participant HumanChat as /api/human-chat
    participant ResolveAPI as /api/human-tasks/[id]/resolve

    Note over User,ResolveAPI: ═══ 第一阶段：Agent 判断需要人工 → 升级 ═══

    User->>ChatUI: "我的充值一直没到账"
    ChatUI->>MsgAPI: POST /api/messages
    MsgAPI->>Agent: run(userMessage, sendSSE)

    activate Agent
    Agent->>Agent: ReAct 迭代 1: query_order_status → pending
    Agent->>Agent: ReAct 迭代 2: query_payment_channel_status → delayed_batch
    Agent->>Agent: postTool Policy: conflict_requires_human → escalated
    Note right of Agent: 系统数据与用户表述矛盾<br/>需要人工确认渠道批次状态

    Agent->>Agent: LLM 决定调用 create_human_task
    Agent->>Agent: preTool Policy: investigate_before_escalation
    Note right of Agent: ✅ 已调用 query_order_status<br/>+ query_payment_channel_status<br/>调查前置条件满足

    Agent->>DB: INSERT HumanTask { question, fields, queue }
    Agent->>DB: UPDATE Case.status = waiting_human
    Agent-->>ChatUI: evt: human_task_created { taskId, question }
    Agent-->>ChatUI: assistant_text: "已转人工处理中，您可以继续提问"
    deactivate Agent

    Note over User,ResolveAPI: ═══ 第二阶段：Operator ↔ Agent 实时咨询 ═══

    ConsoleUI->>DB: GET /api/human-tasks (poll)
    DB-->>ConsoleUI: HumanTask[] 列表
    ConsoleUI->>ConsoleUI: Operator 看到待处理任务

    ConsoleUI->>DB: GET /api/human-tasks/[id]
    DB-->>ConsoleUI: Task + Case + Memory + Traces
    Note right of ConsoleUI: 左侧：Case 摘要<br/>(facts/skills/events)<br/>右侧：咨询聊天界面

    Operator->>HumanChat: POST "渠道批次 CH_BATCH_042 状态如何？"
    HumanChat->>Agent: AgentLoop.run(consultation mode)
    activate Agent
    Note right of Agent: consultation 模式:<br/>独立 system prompt<br/>可调用调查类 Skills

    loop 多轮咨询对话
        Agent->>Agent: query_payment_channel_status(CH_BATCH_042)
        Agent-->>HumanChat: SSE: text_delta + skill_result
        HumanChat-->>ConsoleUI: 流式渲染 Agent 回复
    end

    opt Agent 决定结束咨询
        Agent->>Agent: 调用 finalize_consultation(summary, resolution)
        Note right of Agent: summary: 面向顾客的消息<br/>resolution: confirmed_delayed /<br/>refund_approved / resolved / etc.
        Agent-->>HumanChat: evt: consultation_complete
        HumanChat->>ResolveAPI: notifyAgentResume() POST /resolve
    end

    deactivate Agent

    Note over User,ResolveAPI: ═══ 第三阶段：人工 Close Case → Agent 恢复 → 通知顾客 ═══

    Operator->>ConsoleUI: 点击 "Close Case" + 填写 verdict
    ConsoleUI->>ResolveAPI: POST /api/human-tasks/[id]/resolve { verdict, notes, answers }

    ResolveAPI->>DB: UPDATE HumanTask.status = resolved
    ResolveAPI->>DB: UPDATE Case.status = investigating (blocker 清空)

    ResolveAPI->>MsgAPI: notifyAgentResume(taskId)
    Note right of ResolveAPI: await + retry (3次)<br/>指数退避: 500/1000/2000ms
    MsgAPI->>Agent: run({ resumeTrigger: taskId })
    activate Agent

    Note over Agent: synthetic message 包含:<br/>- verdict (refund_approved)<br/>- operator notes (内部备注)<br/>- 指令: "请翻译为顾客通知"

    Agent->>Agent: ReAct: 生成顾客可见通知消息
    Agent-->>ChatUI: evt: text_delta "您好，经核实您的充值..."
    Agent->>Agent: 调用 finalize_case
    Agent->>Agent: preFinalize Policy: evidence_required_before_resolution ✅
    Agent->>Agent: preFinalize Policy: no_compensation_promise ✅
    Agent->>Agent: preFinalize Policy: must_cite_basis ✅
    Agent->>DB: UPDATE Case.status = resolved
    Agent-->>ChatUI: evt: finalized { summary, resolution }
    deactivate Agent

    ChatUI->>User: 展示闭环结果 + 通知消息
```

---

## 5. Sub-Agent 并行派遣系统

当 Case 进入特定阶段（如 `investigating`），OrchestratorAgent 规划并派遣多个专职 SubAgent 并行执行调查任务，结果增量合并到 CaseMemory 供主 Agent 综合决策。

```mermaid
sequenceDiagram
    participant CoreLoop as AgentLoop (Core)
    participant StageEx as StageExecutor
    participant Orch as OrchestratorAgent
    participant SubA1 as SubAgent<br/>order_investigator
    participant SubA2 as SubAgent<br/>payment_investigator
    participant ToolEx as StreamingToolExecutor
    participant LLM as Anthropic API
    participant Memory as CaseMemoryManager
    participant ChatUI as Chat UI

    Note over CoreLoop: Case 进入 "investigating" 阶段

    CoreLoop->>StageEx: getStageConfig("investigating")
    StageEx-->>CoreLoop: { subAgents: [order_investigator, payment_investigator], ... }

    CoreLoop->>Orch: planInvestigation("investigating", subAgentConfigs, caseMemory, goal)
    activate Orch

    Note over Orch: 为每个 SubAgent 创建 SubAgentTask:<br/>- taskTemplate 填充 caseId/userId<br/>- 分配独立 model/systemPrompt/skills

    Orch->>Orch: 构建 SubAgentTask[]
    loop 每个 SubAgentConfig
        alt config.model 为空
            Orch->>Orch: 回退: AgentConfig.evaluationModel 或 'claude-haiku-4-5-20251001'
        end
        alt config.maxIterations 为空
            Orch->>Orch: 默认 5 轮 ReAct
        end
        alt config.timeoutMs 为空
            Orch->>Orch: 默认 30_000ms
        end
    end

    Orch-->>CoreLoop: SubAgentTask[] (2 tasks)
    deactivate Orch

    CoreLoop->>Orch: dispatchInBackground(tasks, caseMemory, sendSSE)
    activate Orch
    Note right of Orch: fire-and-forget 后台派发<br/>Core Loop 同时继续运行

    par 并行派遣 SubAgent 1: order_investigator
        Orch->>SubA1: new SubAgent(config, skillDefinitions)
        Orch-->>ChatUI: evt: sub_agent_start { name: "order_investigator" }
        activate SubA1
        SubA1->>SubA1: investigateStreaming(task, onProgress)

        loop ReAct Loop (max 3 iterations)
            SubA1->>LLM: anthropic.messages.stream({ system, tools })
            LLM-->>SubA1: text_delta + tool_use
            SubA1->>ToolEx: executeAll(toolUses)
            ToolEx->>ToolEx: query_order_status(txnId)
            ToolEx-->>SubA1: ToolExecutionResult[]
            SubA1-->>ChatUI: evt: sub_agent_progress { type: "tool_call", toolName }
        end

        SubA1-->>SubA1: SubAgentResult { findings, evidence, recommendation, usage }
        SubA1-->>Orch: mergeSingleResult(result)
        deactivate SubA1
    and 并行派遣 SubAgent 2: payment_investigator
        Orch->>SubA2: new SubAgent(config, skillDefinitions)
        Orch-->>ChatUI: evt: sub_agent_start { name: "payment_investigator" }
        activate SubA2
        SubA2->>SubA2: investigateStreaming(task, onProgress)

        loop ReAct Loop (max 3 iterations)
            SubA2->>LLM: anthropic.messages.stream({ system, tools })
            LLM-->>SubA2: text_delta + tool_use
            SubA2->>ToolEx: executeAll(toolUses)
            ToolEx->>ToolEx: query_payment_channel_status(txnId)
            ToolEx-->>SubA2: ToolExecutionResult[]
            SubA2-->>ChatUI: evt: sub_agent_progress { type: "thinking" }
        end

        SubA2-->>SubA2: SubAgentResult { findings, evidence, recommendation, usage }
        SubA2-->>Orch: mergeSingleResult(result)
        deactivate SubA2
    end

    rect rgb(240, 245, 250)
        Note over Orch,Memory: 增量合并结果到 CaseMemory
        Orch->>Memory: mergeSingleResult(subAgentResult)
        Memory->>Memory: findings → confirmedFacts
        Memory->>Memory: evidence → skillResults
        Memory->>Memory: key events → keyEvents
    end

    alt SubAgent 30s 超时
        Orch-->>ChatUI: evt: sub_agent_error { name, error: "timeout" }
        Note right of Orch: Core Agent 告知用户<br/>部分结果可用
    else SubAgent 正常完成
        Orch-->>ChatUI: evt: sub_agent_complete { name, findings, duration }
        Note right of ChatUI: 卡片变绿<br/>展示发现详情
    end

    deactivate Orch

    Note over CoreLoop: Core Loop 下一轮迭代

    CoreLoop->>Orch: hasNewResults()
    Orch-->>CoreLoop: true (2 new results available)

    CoreLoop->>Orch: getNewResults()
    Orch-->>CoreLoop: SubAgentResult[] (merged findings)

    CoreLoop->>Memory: 注入子Agent上下文到 messages
    Note right of Memory: Orchestrator.toContextMessage():<br/>findings + recommendation + usage<br/>Core Agent 下一轮可见

    CoreLoop->>CoreLoop: 综合决策
    Note over CoreLoop: order: status=completed ✅<br/>payment: channel=delayed_batch ⚠️<br/>→ 用户申报"未到账"与系统矛盾<br/>→ 决定 escalate to human

    CoreLoop->>StageEx: evaluateTransition("investigating")
    StageEx-->>CoreLoop: { shouldTransition: true, nextStage: "waiting_human" }
    CoreLoop-->>ChatUI: evt: case_status { stage: "waiting_human" }

    ChatUI->>ChatUI: DedicatedAgentsPanel 展示所有子Agent结果
```

---

## 附录：SSE 事件类型速查

| SSE Event Type | 触发时机 | 方向 |
|----------------|----------|------|
| `stream_request_start` | LLM API 请求开始 | Agent → ChatUI |
| `thinking_delta` | LLM 扩展思考内容 | Agent → ChatUI |
| `text_delta` | LLM 生成文本片段 | Agent → ChatUI |
| `tool_executing` | 工具开始执行 | ToolEx → ChatUI |
| `skill_result` | 工具执行完成 | ToolEx → ChatUI |
| `case_created` | 自动建案成功 | Agent → ChatUI |
| `case_status` | 阶段转换发生 | Agent → ChatUI |
| `memory_update` | CaseMemory 变更 | Agent → ChatUI |
| `human_task_created` | 人工任务创建 | Agent → ChatUI |
| `consultation_complete` | 人工咨询结束 | HumanChat → ChatUI |
| `sub_agent_start` | 子Agent 开始执行 | Orch → ChatUI |
| `sub_agent_progress` | 子Agent 工具调用/思考 | SubAgent → ChatUI |
| `sub_agent_complete` | 子Agent 正常完成 | Orch → ChatUI |
| `sub_agent_error` | 子Agent 超时/失败 | Orch → ChatUI |
| `core_agent_progress` | 主Agent 迭代进度 | Agent → ChatUI |
| `form_request` | 动态表单请求 | Agent → ChatUI |
| `interaction_proposed` | 交互按钮卡片 | Agent → ChatUI |
| `clarification` | 多意图澄清 | Agent → ChatUI |
| `finalized` | Case 闭环成功 | Agent → ChatUI |
| `message_stop` | 消息生成结束 | MsgAPI → ChatUI |
| `error` | 错误发生 | Agent → ChatUI |
| `withheld` | 错误暂缓显示 | Agent → ChatUI |

---

## 附录：核心类与模块索引

| 文件 | 类/导出 | 职责 |
|------|---------|------|
| `apps/chat/lib/agent/loop.ts` | `AgentLoop` | 主 ReAct 循环引擎 |
| `apps/chat/lib/agent/stage-executor.ts` | `StageExecutor` | 阶段门控执行、转换评估、Nudge |
| `apps/chat/lib/agent/orchestrator.ts` | `OrchestratorAgent` | 子Agent 派遣规划、并行调度、增量合并 |
| `apps/chat/lib/agent/sub-agent.ts` | `SubAgent` | 隔离调查Agent，独立模型+工具集 |
| `apps/chat/lib/agent/streaming-tool-executor.ts` | `StreamingToolExecutor` | 流式工具执行，并行/串行调度 |
| `apps/chat/lib/agent/skills.ts` | `SkillRouter` | Skill 注册中心，mock/http 路由 |
| `apps/chat/lib/agent/policy.ts` | `PolicyEngine` | 策略引擎，preTool/postTool/preFinalize |
| `apps/chat/lib/agent/memory.ts` | `CaseMemoryManager` | 四层上下文管理，事实提取 |
| `apps/chat/lib/agent/trace.ts` | `TraceWriter` | 可观测性追踪写入 |
| `apps/chat/lib/agent/compact.ts` | `compactConversation` | LLM 对话压缩 |
| `apps/chat/lib/agent/microCompact.ts` | `microCompact` | 工具结果去重清理 |
| `apps/chat/lib/agent/prompt-resolver.ts` | `resolvePrompt` | 提示词占位符替换 |
| `apps/chat/lib/agent/config-cache.ts` | `getCachedConfig` | 30s TTL 配置缓存 |
| `apps/chat/app/api/messages/route.ts` | POST handler | 消息入口 API |
| `apps/chat/app/api/human-chat/route.ts` | POST handler | 人工咨询 API |
