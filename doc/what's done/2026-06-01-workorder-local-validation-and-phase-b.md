# 工单：本地部署演练 + Phase B UI（coding agent 执行）

> **现状**：`main` = `9899c74`，Phase A 迁移 + 鉴权已完成并经核实。
> 部署到 Ubuntu（`intera.kilo.pub` / `43.134.51.138`）**暂卡在 TLS/域名/安全组**（同事在搞 HTTPS 域名 + 开 80/443），与本工单无关。
> 本工单是**不依赖公网服务器**、现在就能做的活，目的是：① 在本地把部署的 80% 未知数消掉；② 推进 Phase B UI。
>
> **关联文档（执行时同时打开）：**
> - 总指挥 + Phase B 细节 + §2.5 鉴权 + §B3.1 Playground：[2026-06-01-combined-migration-and-ui-refactor.md](doc/to-do/2026-06-01-combined-migration-and-ui-refactor.md)
> - Ubuntu 部署 spec：[2026-06-01-deploy-ubuntu.md](doc/to-do/2026-06-01-deploy-ubuntu.md)
> - 部署鉴权清单（需修两处笔误）：[2026-06-01-deploy-auth-checklist.md](doc/to-do/2026-06-01-deploy-auth-checklist.md)

---

## 执行顺序（严格）

**先做轨道 A（A1→A4），全绿后再切轨道 B，逐页 checkpoint。**
轨道 A 利用"等域名"窗口提前排雷；轨道 B 是主菜但不阻塞上线。
**`apps/chat` 暂时不删**（留作参照，console 不依赖它；本地演练通过 + Phase B 稳定后再清理）。

---

## 轨道 A：本地部署演练（消除部署未知数）

> 前提：用**本地 PostgreSQL**（与生产同 provider，**勿用 sqlite**，否则演练不保真）。可 `docker run -e POSTGRES_PASSWORD=... -p 5432:5432 postgres` 或本地安装。

### A1. 本地 standalone 演练（最高优先）
按 [deploy-ubuntu.md](doc/to-do/2026-06-01-deploy-ubuntu.md) §3–§5 在本地复现 standalone 运行：
- [ ] `npm run db:generate && npm run build:console`
- [ ] cp static **和 public** 进 standalone（注意 Railway 原命令漏了 public，见 §3）
- [ ] 用 deploy-ubuntu §4 的 env（`INTERNAL_API_SECRET`、`PORT=3000`、`INTERNAL_CHAT_API_URL=http://localhost:3000`、本地 `DATABASE_URL`）`node apps/console/.next/standalone/apps/console/server.js` 跑起来
- [ ] `npm run db:push && npm run db:seed`

**验收标准（全部满足才算过）：**
- [ ] `curl localhost:3000/api/health` → 200
- [ ] 无 `Authorization` 打 `POST /api/messages` → **401**
- [ ] 生成 key（`POST /api/admin/api-keys`，cookie 会话）→ 带 `Bearer` 打 `/api/messages`：正常返回 SSE，且 **body 里塞 `orgId:"other"` 被忽略、实际用 key 推导的 org**
- [ ] SSE 是**逐段流式**到达（非一次性吐）
- [ ] 模拟 bridge 内部调用：带 `x-intera-internal: $INTERNAL_API_SECRET` + `x-intera-org` → 200；密钥错 → 401
- [ ] journalctl/控制台无报错

### A2. 提前排掉 Prisma standalone 坑
- [ ] 若 A1 启动报 `Query engine library not found`：在 `apps/console/next.config.js` 加 `outputFileTracingIncludes`（把 `node_modules/.prisma`、`@prisma/client` 引擎纳入 standalone 追踪），重build 验证。**在仓库里修掉，而非部署当天踩。**
- [ ] 若不报错，也在工单回执里写明"standalone 已含 prisma 引擎，无需额外处理"。

### A3. 部署产物落进仓库（版本化，供同事直接用）
基于 deploy-ubuntu spec 生成并提交：
- [ ] `scripts/deploy.sh`（§11 的更新命令序列：pull→ci→generate→build→cp static+public→restart）
- [ ] `deploy/intera-console.service`（§5 systemd unit）
- [ ] `deploy/Caddyfile`（§6，含 SSE `flush_interval -1` 的 matcher）
- [ ] `deploy/console.env.example`（§4 的变量清单，**不含真实密钥**，占位符）

### A4. 核对 deploy-ubuntu 回滚说明
- [ ] 确认 [deploy-ubuntu.md](doc/to-do/2026-06-01-deploy-ubuntu.md) §13 回滚说明准确：已加 `ApiKey` 表，回滚时**别对旧 schema 跑 `--accept-data-loss`**（否则删表）。
  （注：原 Railway 版 `deploy-auth-checklist.md` 已归档到 `doc/what's done/`，部署以 deploy-ubuntu 为准。）

**轨道 A 完成定义：** A1 验收全过 + A2 结论明确 + A3 四个文件已提交 + A4 已核对。给我一份回执（验收项逐条结果）。

---

## 轨道 B：Phase B UI（逐页，每页做完先等我确认再下一页）

> 细节以 [combined spec](doc/to-do/2026-06-01-combined-migration-and-ui-refactor.md) §4（Phase B）为准。**全程只动 `apps/console`。** 每完成一页：自测 + 截图/证据 → 等确认 → 再下一页。

### B1. InteraLogo 动画（先做，热身，~1-2h）
- 按 combined spec §B1 + HANDOFF §2：新建 `packages/shared/ui/intera-logo.tsx`（导入路径已验证），CSS 进 `apps/console/app/globals.css`，替换 sidebar wordmark。
- **验收**：加载时 "Intera" 展开、收起侧边栏折叠成 "I"（Chrome 实测截图）。
- → **停，等确认。**

### B2. 侧边栏重组 BUILD/OPERATE
- combined spec §B2：重组分组 + **同步 i18n key**（`locale-provider.tsx`）+ 处理 `admin/sub-agents` 孤儿页 + 物理路由保持 `/admin` `/ops` 不变。
- → **停，等确认。**

### B3. Playground 页 + `/api/admin/playground/run`（核心）
- combined spec §B3 + **§B3.1 必读**（trace 阻抗不匹配的施工说明）：
  - 复用真实 pipeline（Approach A），**TraceWriter 内存模式、零 DB 写**
  - 按映射表把细粒度 ActionType 聚合成 6 阶段 + 计时 + status
  - **dry-run**：`operational` 类工具走 mock（用 `toolCategory` 区分），`system_info` 类可真调
  - ConfigPanel toggle 仅临时覆盖本次调用，不回写真实 config
- → **停，等确认。**

### B4. Docked Preview / B5. Dashboard
- 按 combined spec §B4/§B5，各自做完 → 停，等确认。

---

## 回执要求
每个轨道/每页完成后，回执包含：改动文件清单、验收项逐条结果、`npm run build:console` + `npm test` 门禁结果、UI 项附 Chrome 截图。**不要在本工单内删 `apps/chat`、不要碰部署到公网服务器。**
