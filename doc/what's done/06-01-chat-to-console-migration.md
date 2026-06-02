# Chat → Console 迁移：数据模型清理 + 应用合并 + UI 重构

> **来源合并**: `case-agent-refactor.md` + `chat-to-console-migration.md` + `combined-migration-and-ui-refactor.md` + `计划：caseId 降级 + chatId 主键化.md`
> **状态**: Phase A ✅ 已完成（commit `778c498`），Phase B UI ⏳ 待办

---

## Phase 0：数据模型清理

### 问题

`chatId`（会话分组）和 `caseId`（工单）关系混乱：
- `Case.chatId` 可空 → 到处 `OR: [{chatId}, {id:chatId}]` 兜底
- `create_case` 触发主 Agent 模式切换（Core→Case）
- 每个 stage 可 dispatch 多个 sub-agent，stage transition 用 LLM 评估
- `ChatMemory` 1:1 绑 caseId，无 chat 级别内存

### 目标架构

- `chatId` 是唯一会话标识，一个 chat = 一个主 AgentLoop（始终对话模式）
- `dispatch_case_agent` spawn 后台 case agent，主 Agent 不受影响
- Stage config 保留（工具过滤 + nudge prompt），去除 per-stage dispatch + LLM transition
- 新建 `ChatSession` 表存 chat 级别内存，`ChatMemory` 继续 1:1 绑 caseId
- `Skill.toolCategory` 字段区分系统信息工具 / 操作工具

### 关键改动

- `Case.chatId` → NOT NULL，`@unique` 约束改为 `(caseId)` 单字段
- API routes: 废弃 `caseId` 路径参数，统一 `chats/[chatId]` 风格
- `dispatch_case_agent` 从 "切换模式" 改为 spawn 后台 case agent
- LiveChat renderer 从 `buildLiveChatActions()` 改 channel-agnostic SSE stream consumption

---

## Phase A：Chat → Console 迁移

### 决策

**Console 作为唯一 SaaS 应用。** `apps/chat` 整体废弃删除。一个 Next.js 应用承载：管理后台 UI + 全部 API + Agent 引擎 + LiveChat Bridge + 多渠道渲染。

### 鉴权体系（commit `f968620` + `9899c74`）

```
外部请求 → 三选一鉴权门:
  1. Cookie session (Console 浏览器): intera_auth + intera_org_id
  2. API Key (LiveChat webhook / 外部): Bearer intera_sk_* → 推导 org
  3. Internal secret (bridge 自调用): x-intera-internal + x-intera-org
```

**多租户隔离**: API Key 绑 org，请求 body 中的 `orgId` 字段被静默忽略。`ApiKey` 表新增，hash 存储，支持 lastUsedAt + revoked 管理。

### 迁移清单

| 模块 | 动作 |
|------|------|
| Agent Engine | `apps/chat/lib/agent/` → `apps/console/lib/agent/`，import 路径全局更新 |
| LiveChat Bridge | 移入 console，webhook URL 同步更新 |
| API Routes | `/api/messages`、`/api/livechat/*`、`/api/cases/*` 移入 console |
| Worker | case-continuation worker 移入 console |
| Prisma | 单 schema（已 shared），`db push` 改 console 脚本 |
| Build | 单 `next build` |

### 暂不删 `apps/chat`

Phase B 稳定 + 本地演练通过后再清理。部署回滚：webhook 指回旧 chat service 即可，DB 零变更。

---

## Phase B：Intera Design System UI 重构

> 以 [Intera Design System/HANDOFF.md](Intera%20Design%20System/HANDOFF.md) 为准。全程只动 `apps/console`。逐页做→停→确认。

| 页 | 内容 |
|----|------|
| **B1 InteraLogo** | 新建 `shared/ui/intera-logo.tsx`，CSS 进 globals.css，sidebar 替换 wordmark。加载展开 "Intera"，收起折叠 "I" |
| **B2 侧边栏** | BUILD/OPERATE 重组 + i18n 同步 + 孤儿页处理 |
| **B3 Playground** | 复用真实 pipeline，TraceWriter 内存模式、零 DB 写，operational 工具 mock，6 阶段聚合 |
| **B4 Docked Preview** | 按 HANDOFF spec |
| **B5 Dashboard** | 按 HANDOFF spec |

---

## 本地部署演练（轨道 A）

不等 Ubuntu 就绪，本地 PostgreSQL standalone 复现：
1. `npm run db:generate && npm run build:console`
2. cp static + public 进 standalone
3. 设 env 跑 standalone server
4. 验证 `/api/health` 200、401 auth gate、SSE 流式、bridge 内调鉴权

Prisma standalone 坑：若报 `Query engine library not found`，在 `next.config.js` 加 `outputFileTracingIncludes` 纳入 `node_modules/.prisma`。

---

## 回归测试 Guide

| 场景 | 验证 |
|------|------|
| Web Chat 文字消息 | 302 → SSE → agent 回复 → 流式渲染 |
| LiveChat 文字消息 | webhook → bridge → 同上 → LiveChat widget 可见 |
| LiveChat rich message | send_event → card/carousel 渲染 |
| **Auth gate** | 无 Auth → 401；API Key → 200；Internal secret → 200；secret 错 → 401 |
| **多租户隔离** | API Key 绑 org A，打 org B 的 case → 被拒绝 |
| **Case lifecycle** | create → dispatch_case_agent → finalize |
| **Compact** | 手动 compact → summary 生成 → ChatMemory 写入 |
| Console 登录 | 正常 + cookie session 获取 org |
