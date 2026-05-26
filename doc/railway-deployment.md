# Railway 部署指南

> intera-agent monorepo 的 Railway 部署说明。记录了构建方式、配置、踩过的坑以及故障复盘。

---

## 目录

1. [项目结构](#项目结构)
2. [Builder：Railpack](#builderrailpack)
3. [部署方式：railway.json + CLI](#部署方式railwayjson--cli)
4. [关键知识：Monorepo Standalone 路径](#关键知识monorepo-standalone-路径)
5. [必须设置的环境变量](#必须设置的环境变量)
6. [多服务部署流程](#多服务部署流程)
7. [本地开发](#本地开发)
8. [常见故障速查](#常见故障速查)
9. [历史事故复盘](#历史事故复盘)

---

## 项目结构

```
intera-agent/                    ← npm workspaces monorepo 根目录
├── apps/
│   ├── chat/                    ← 客户端聊天 App（面向访客）
│   └── console/                 ← 运营控制台（面向坐席/管理员）
├── packages/
│   └── shared/                  ← Prisma schema、类型、工具函数
├── package.json                 ← root workspace 配置
└── railway.json                 ← Railpack 构建配置（.gitignore，不入库）
```

两个 App 均为 Next.js `output: 'standalone'` 模式，分别部署为独立的 Railway Service。

---

## Builder：Railpack

Railway 当前使用自研的 **Railpack** 构建器（runtime=V2）。它读取项目根目录的 `railway.json` 获取 build/start 命令。

```
git push / railway up
  │
  ▼ Railpack 读取 railway.json
  │
  ├─ Build 阶段（buildCommand）
  │
  └─ Start 阶段（startCommand）
```

**本项目不使用 Docker 或 Nixpacks**，相关文件已移除。

---

## 部署方式：railway.json + CLI

`railway.json` 在 `.gitignore` 中，不入库。部署时通过 Railway CLI 的 `railway up` 命令，Railpack 会根据上传目录中的 `railway.json` 执行构建。

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

**Build 阶段：**

| 步骤 | 命令 | 作用 |
|------|------|------|
| 1 | `npx prisma generate` | 生成 Prisma Client |
| 2 | `npm run build -w apps/chat` | `next build`，输出 `.next/standalone/` |
| 3 | `cp .next/static` | 静态资源复制到 standalone 正确位置 |

**Start 阶段：**

| 步骤 | 命令 | 作用 |
|------|------|------|
| 1 | `npx prisma db push` | 同步 Prisma schema 到 Postgres |
| 2 | `node .../server.js` | 启动 Next.js standalone 服务器 |

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

> Console 不需要 `prisma db push`，数据库迁移由 Chat 服务负责。

---

## 关键知识：Monorepo Standalone 路径

npm workspaces 中，Next.js standalone 的 `server.js` 在 workspace 子路径下：

```
apps/chat/.next/standalone/
  apps/chat/
    server.js        ← 真正的入口
    .next/           ← 服务端 build 产物
  packages/
    shared/          ← 依赖的 workspace 包（自动复制）
  node_modules/      ← 精简后的运行时依赖
```

**正确命令（从 repo 根目录）：**
```bash
node apps/chat/.next/standalone/apps/chat/server.js
```

**为什么 `.next/static` 要手动复制：** standalone 模式不会自动打包静态资源（CSS、JS chunks），需要 `cp` 到 standalone 目录中。

---

## 必须设置的环境变量

### Chat 服务

| 变量 | 说明 |
|------|------|
| `HOSTNAME=0.0.0.0` | **必须**，否则 502 |
| `ANTHROPIC_AUTH_TOKEN` | Agent LLM 调用 |
| `ANTHROPIC_BASE_URL` | 模型 API 地址 |
| `DEEPSEEK_API_KEY` | Composer Assist |
| `GPTBOTS_API_KEY` | 知识库检索 |
| `DATABASE_URL` | Railway 自动注入 |

### Console 服务

| 变量 | 说明 |
|------|------|
| `HOSTNAME=0.0.0.0` | **必须** |
| `DATABASE_URL` | 与 Chat 共用同一个 DB |
| `NEXT_PUBLIC_CHAT_API_URL` | Chat 服务的公网地址 |

### `HOSTNAME=0.0.0.0` 为什么是必须项

Railway 将容器 hostname 注入为 `HOSTNAME` 环境变量，Next.js standalone 读取该变量作为监听地址。若不显式覆盖为 `0.0.0.0`，服务只绑定容器内部 hostname，Railway 反向代理无法路由 → 公网 502。

---

## 多服务部署流程

`railway.json` 一次只能指向一个服务。部署流程：

```bash
# 1. 将 railway.json 改为目标服务的配置（如 console）
# 2. 上传并触发构建
railway up --service console --detach

# 3. 等待构建完成
railway deployment list --service console

# 4. 将 railway.json 改回 chat 配置（默认状态）
```

> **注意**：`railway up` 的上传内容包含 railway.json，Railpack 以此决定构建逻辑。Chat 是 linked service（`railway service link chat`），日常 railway.json 保持 chat 配置。

---

## 本地开发

```bash
npm run dev -w apps/chat      # Chat (port 3000)
npm run dev -w apps/console   # Console (port 3001)
npm run db:studio -w packages/shared  # Prisma Studio (port 5555)
```

---

## 常见故障速查

### 服务 Online 但公网 502

**原因：** `HOSTNAME` 未设为 `0.0.0.0`。

**确认：** Runtime Log 中 `Network: http://<hostname>:8080` 而非 `0.0.0.0:8080`。

**修复：** Railway Variables 中添加 `HOSTNAME=0.0.0.0`，redeploy。

---

### `Cannot find module .../server.js`

**原因：** 路径错误。Monorepo 中 server.js 在 `standalone/apps/chat/server.js`，不是 `standalone/server.js`。

---

### Build 阶段 `next: not found`

**原因：** 用了 `next start` 启动 standalone 构建。standalone 模式不包含 `next` binary。

**修复：** 使用 `node .../standalone/apps/chat/server.js`。

---

## 历史事故复盘

### 2025-05 三次故障

**第一轮 — `next: not found`**
- `apps/chat/package.json` 的 start 脚本是 `next start`，但 standalone 模式下没有 next binary
- 修复：改为 `node server.js`

**第二轮 — `Cannot find module`**
- 项目原有 `nixpacks.toml`，以为 Railway 会用 Nixpacks，但 Railway 已切换到 Railpack
- Railpack 静默忽略了 `nixpacks.toml`，Build 阶段只做了 `npm ci`
- 修复：创建 `railway.json`，明确写出 build/start 命令

**第三轮 — Online 但 502**
- Next.js 读取了 Railway 注入的容器 hostname 作为 `HOSTNAME`
- 服务只绑定到内部 hostname，Railway 代理无法路由
- 修复：显式设置 `HOSTNAME=0.0.0.0`
