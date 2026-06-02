# Ubuntu 自建部署 + 鉴权 + Phase B

> **来源合并**: `2026-06-01-deploy-ubuntu.md` + `2026-06-01-deploy-auth-checklist.md` + `2026-06-01-workorder-local-validation-and-phase-b.md`
> **方案**: 放弃 Railway，自建 Ubuntu 单机部署。`apps/chat` 已废弃，Console 为唯一 SaaS 应用。
> **状态**: 鉴权 Phase A 已完成（commit `9899c74`）。Ubuntu 部署卡在 TLS/域名/安全组，Phase B UI 待办。

---

## 1. 服务器基线

- **目标机**: `43.134.51.138`（Ubuntu，公网 IP），经腾讯云 NAT → 内网 `172.22.16.7`
- **模型**: 单机 = Console(Next standalone) + 本地 PostgreSQL + Caddy(反代+自动TLS)
- **域名**（LiveChat 硬依赖）: webhook 必须有受信 HTTPS 证书，裸 IP 不行

### 前置阻断项

1. **改 SSH 密码 + 换密钥登录**（密码已明文暴露）
2. **域名 A 记录** 指向服务器（如 `agent.yourdomain.com`，否则 LiveChat 不通）
3. **腾讯云安全组放行** TCP:80 + TCP:443 + TCP:22（收紧）

---

## 2. 部署架构

```
                   ┌─────────────┐
                   │   Caddy      │
                   │ :80 → :443   │
                   │ TLS (auto)   │
                   └──────┬───────┘
                          │ proxy
                   ┌──────▼───────┐
                   │ Next.js      │
                   │ standalone   │
                   │ :3000        │
                   └──────┬───────┘
                          │
                   ┌──────▼───────┐
                   │ PostgreSQL   │
                   │ :5432        │
                   └──────────────┘
```

### 环境变量

```bash
DATABASE_URL=postgresql://intera:<pwd>@localhost:5432/intera
INTERNAL_API_SECRET=<rand-hex-64>     # bridge 自调用鉴权
INTERNAL_CHAT_API_URL=http://localhost:3000  # 同进程自调用
PORT=3000
NODE_ENV=production
```

### 部署产物（版本化进仓库）

- `scripts/deploy.sh` — pull→ci→generate→build→cp static+public→restart
- `deploy/intera-console.service` — systemd unit
- `deploy/Caddyfile` — Caddy 配置（含 SSE `flush_interval -1`）
- `deploy/console.env.example` — 环境变量模板

---

## 3. 鉴权体系

迁移后（commit `f968620` + `9899c74`），鉴权架构：

```
外部请求 → 三选一鉴权门:
  1. Cookie session (Console 浏览器): intera_auth + intera_org_id → org 上下文
  2. API Key (LiveChat webhook / 外部): Bearer intera_sk_* → 推导 org
  3. Internal secret (bridge 自调用): x-intera-internal + x-intera-org → 信任
```

**Bridge 自调用**: livechat bridge → `POST /api/messages`，带 `x-intera-internal: $INTERNAL_API_SECRET` + `x-intera-org`。

**API Key 生成**: Console 管理后台 `POST /api/admin/api-keys`，返回 `{ plaintext: "intera_sk_live_..." }`（仅显示一次）。

**多租户隔离**: 鉴权门通过 org 上下文做路由隔离。API Key 绑 org，请求中带的 `orgId` 字段被忽略。

---

## 4. 本地部署演练（轨道 A）

> 不等 Ubuntu 就绪，先在本地用 PostgreSQL 复现 standalone 运行，提前消掉 80% 未知数。

### 步骤

1. `npm run db:generate && npm run build:console`
2. cp static **和 public** 进 standalone
3. 设 env 跑 `node apps/console/.next/standalone/apps/console/server.js`
4. `npm run db:push && npm run db:seed`

### 验收

- `curl localhost:3000/api/health` → 200
- 无 Auth 打 `/api/messages` → 401
- 生成 API Key → 带 Bearer 打 `/api/messages` 正常 SSE，orgId 字段被忽略
- SSE 逐段流式到达
- 模拟 bridge 内调：`x-intera-internal` + `x-intera-org` → 200；密钥错 → 401
- **Prisma standalone 引擎坑**: 若启动报 `Query engine library not found`，在 `next.config.js` 加 `outputFileTracingIncludes` 把 `node_modules/.prisma` 纳入

---

## 5. Phase B UI（待办）

> 细节以 combined-migration spec §4 为准。全程只动 `apps/console`。逐页做→停→确认。

| 页 | 内容 | 验收 |
|----|------|------|
| **B1 InteraLogo** | 新建 `shared/ui/intera-logo.tsx`，CSS 进 globals.css，替换 sidebar wordmark | 加载展开 "Intera"，收起折叠 "I" |
| **B2 侧边栏** | BUILD/OPERATE 重组 + 同步 i18n + 处理孤儿页 | 路由保持 `/admin` `/ops` |
| **B3 Playground** | 复用真实 pipeline，TraceWriter 内存模式、零 DB 写，operational 工具 mock | 6 阶段聚合 + 计时 + status |
| **B4 Docked Preview** | 按 spec | — |
| **B5 Dashboard** | 按 spec | — |

---

## 6. 回滚

若 Console 阻塞：LiveChat webhook 指回 chat service，`git checkout <pre-migration-tag>` 重部署。DB 零变更，秒级可逆。

稳定观察一个业务周期（建议 24h）后，`rm -rf apps/chat`。
