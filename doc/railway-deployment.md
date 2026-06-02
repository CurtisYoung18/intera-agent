# Railway 部署指南

> intera-agent monorepo 的 Railway 部署说明。两个 Next.js 服务（chat + console），基于实战验证。

---

## 1. 项目结构

```
intera-agent/
├── apps/
│   ├── chat/        ← 客户端聊天 App + AI Agent 引擎
│   └── console/     ← 运营控制台（配置 + 监控）
├── packages/
│   └── shared/      ← Prisma schema、类型、工具函数
├── railway.json     ← Railpack 构建配置（.gitignore，不入库）
├── scripts/
│   └── deploy.sh    ← 一键部署脚本
└── CLAUDE.md        ← AI 辅助开发指引
```

两个 App 均使用 Next.js `output: 'standalone'` 模式，通过 Railpack 构建。

---

## 2. Builder：Railpack

Railway 使用 **Railpack**（runtime=V2）。它读取项目根目录的 `railway.json` 获取 build/start 命令。

**不需要 Dockerfile 或 Nixpacks**。`railway.json` 是唯一的构建配置文件。

---

## 3. 部署脚本

`scripts/deploy.sh` 是一键部署入口。它自动完成 `railway.json` 替换 + 上传 + 状态检查：

```bash
./scripts/deploy.sh chat      # 部署 Chat 服务
./scripts/deploy.sh console   # 部署 Console 服务
```

**工作原理**：
1. 根据参数生成对应的 `railway.json`（chat 或 console 配置）
2. `railway up --service <name>` 上传并触发构建
3. 检查部署状态
4. 恢复 `railway.json` 为 chat 配置（默认）

**为什么需要替换 railway.json**：`railway up` 上传整个目录，包括 `railway.json`。两个服务的 build/start 命令不同，必须在上传前写入正确配置。**这是之前 Console 502 和 "Console 显示 Chat App" 错误的根因**。

---

## 4. 服务配置

### Chat 服务

```json
{
  "build": {
    "buildCommand": "npx prisma generate --schema=./packages/shared/prisma/schema.prisma && npm run build -w apps/chat && cp -r apps/chat/.next/static apps/chat/.next/standalone/apps/chat/.next/static"
  },
  "deploy": {
    "startCommand": "npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate && node apps/chat/.next/standalone/apps/chat/server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

- 负责 `prisma db push`（数据库迁移的唯一入口）
- standalone server 路径：`apps/chat/.next/standalone/apps/chat/server.js`

### Console 服务

```json
{
  "build": {
    "buildCommand": "npx prisma generate --schema=./packages/shared/prisma/schema.prisma && npm run build -w apps/console && cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static"
  },
  "deploy": {
    "startCommand": "node apps/console/.next/standalone/apps/console/server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

- **不执行 `prisma db push`**（数据库迁移由 Chat 负责）
- standalone server 路径：`apps/console/.next/standalone/apps/console/server.js`

---

## 5. 环境变量

### Chat 服务

| 变量 | 说明 |
|------|------|
| `HOSTNAME=0.0.0.0` | **必须**——否则 Next.js 只绑定容器 hostname，公网 502 |
| `ANTHROPIC_AUTH_TOKEN` | LLM API 认证 |
| `ANTHROPIC_BASE_URL` | 模型 API 地址（MiniMax/DeepSeek/Anthropic） |
| `GPTBOTS_API_KEY` | 知识库检索 API Key |
| `DATABASE_URL` | Railway 自动注入 |

### Console 服务

| 变量 | 说明 |
|------|------|
| `HOSTNAME=0.0.0.0` | **必须**——同上 |
| `DATABASE_URL` | 与 Chat 共用同一个 DB |
| `NEXT_PUBLIC_CHAT_API_URL` | Chat 服务的公网地址 |
| `ANTHROPIC_AUTH_TOKEN` | 共用 LLM 凭据 |
| `ANTHROPIC_BASE_URL` | 共用模型 API 地址 |

---

## 6. Monorepo Standalone 路径

Next.js standalone 的 `server.js` 在 workspace 子路径下：

```
apps/chat/.next/standalone/
  apps/chat/
    server.js        ← 入口
    .next/           ← 构建产物
  packages/shared/   ← workspace 依赖（自动复制）
  node_modules/      ← 精简后的运行时依赖
```

`.next/static` 需要手动复制——standalone 模式不自动打包静态资源。

---

## 7. 常见故障速查

### Console 502（部署后）

**最常见的原因：** `railway.json` 没替换——Console 上传时用了 Chat 的 `railway.json`，导致构建出 Chat App 而非 Console。Console 的 Next.js 收到 `/admin/agent` 请求找不到路由，返回 404 或崩溃。

**修复：** 使用 `./scripts/deploy.sh console` 部署（自动替换）。不要手动 `railway up --service console`。

### 服务 Online 但公网 502

**原因：** `HOSTNAME` 未设为 `0.0.0.0`。

**确认：** Runtime Log 中 `Network: http://<hostname>:8080` 而非 `0.0.0.0:8080`。

**修复：** Railway Variables 中添加 `HOSTNAME=0.0.0.0`，redeploy。

### Skills 页面缺少系统技能

**现象：** Skills 页面没有 `finalize_sub_agent`、`todo_write`、`todo_read` 等新增系统技能。

**原因：** 这些技能在后续版本加入 `DEFAULT_SKILLS`，但 auto-seed 只在表为空时触发。已有数据的 customer 不会自动获得新技能。

**修复：** GET `/api/admin/skills` 现在每次请求都会检查 system/special 技能缺失，自动 upsert。刷新页面即可。

### `Cannot find module .../server.js`

**原因：** 路径错误。Monorepo 中 server.js 在 `standalone/apps/chat/server.js`，不是 `standalone/server.js`。

### `next: not found`

**原因：** 用了 `next start` 启动 standalone 构建。standalone 模式不包含 `next` binary。

**修复：** 使用 `node .../standalone/apps/chat/server.js`。

---

## 8. 本地开发

```bash
npm run dev -w apps/chat      # Chat (port 3000)
npm run dev -w apps/console   # Console (port 3001)
npm run db:studio              # Prisma Studio (port 5555)
```

---

## 9. 历史事故复盘

### 2025-05 三次故障

**第一轮 — `next: not found`**：standalone 模式下没有 `next` binary，不能用 `next start`。修复：改为 `node server.js`。

**第二轮 — `Cannot find module`**：Railway 已切换到 Railpack，项目原有的 `nixpacks.toml` 被静默忽略。修复：创建 `railway.json` 显式配置 build/start 命令。

**第三轮 — Online 但 502**：Next.js 读取了 Railway 注入的容器 hostname，只绑定内部地址。修复：显式设置 `HOSTNAME=0.0.0.0`。

### 2026-05 两轮故障

**第四轮 — Console 502（部署脚本缺陷）**：`railway up --service console` 上传了整个目录，但 `railway.json` 仍是 Chat 配置。Railpack 构建出 Chat App 部署到 Console 服务，导致 Console 404/502。修复：`deploy.sh` 在部署前根据目标服务替换 `railway.json`。

**第五轮 — Console 502（HOSTNAME 缺失）**：Console 服务从 Nixpacks 迁移到 standalone 后，未设置 `HOSTNAME=0.0.0.0`，导致同样的绑定问题。修复：在 Console 环境变量中添加。

---

## 10. SSL 证书续期策略

> 当前：手动 DigiCert/RapidSSL 通配符证书，2026-07-22 到期。
> 部署方式：自托管 Ubuntu + Caddy（`demo.anytrans.ai`）。

### 方案 A：手动续期（当前方式）

在腾讯云 SSL 控制台重新申请/续期证书，下载 Nginx 版本，scp 到服务器：

```bash
# 1. 上传新证书
scp demo.anytrans.ai_server.crt ubuntu@43.134.51.138:/tmp/
scp demo.anytrans.ai_server.key ubuntu@43.134.51.138:/tmp/

# 2. 安装
ssh ubuntu@43.134.51.138
sudo mv /tmp/demo.anytrans.ai_server.crt /etc/intera/tls/demo.anytrans.ai.crt
sudo mv /tmp/demo.anytrans.ai_server.key /etc/intera/tls/demo.anytrans.ai.key
sudo chmod 600 /etc/intera/tls/demo.anytrans.ai.key
sudo systemctl reload caddy

# 3. 验证
curl -sI https://demo.anytrans.ai/api/health | head -5
```

### 方案 B：切换到 Let's Encrypt 自动 TLS

Caddy 原生支持 Let's Encrypt，但通配符证书需要 DNS 挑战。修改 Caddyfile：

```caddy
# 删除 tls /path/to/cert 行，Caddy 自动申请 Let's Encrypt
demo.anytrans.ai {
    encode gzip
    # tls 行已移除 — Caddy 自动管理

    @sse path /api/messages /api/cases/*/stream
    reverse_proxy @sse localhost:3000 { flush_interval -1 }
    reverse_proxy localhost:3000
}
```

**前提条件：**
- 服务器 80 端口可公网访问（ACME HTTP 挑战）
- 如用通配符 `*.demo.anytrans.ai`，需配置 DNS 挑战插件（如 `tls { dns cloudflare }`）
- 非通配符 `demo.anytrans.ai` 无需额外配置

**推荐：** 方案 A（手动续期）最简单可靠，提前 7 天设置日历提醒即可。方案 B 需要 DNS API 配置，适合长期维护。
