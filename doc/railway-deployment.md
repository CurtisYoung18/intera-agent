# Railway 部署指南

> 适用于 intera-agent monorepo 的 Railway 部署说明。记录了架构、配置、踩过的坑，以及每次故障的完整复盘。
>
> **如果你正在调查一个部署问题，请先查阅「常见故障速查」章节。**

---

## 目录

1. [项目结构](#项目结构)
2. [Builder 选型：Railpack](#builder-选型railpack)
3. [当前配置文件详解](#当前配置文件详解)
4. [关键知识：Monorepo Standalone 路径](#关键知识monorepo-standalone-路径)
5. [必须设置的环境变量](#必须设置的环境变量)
6. [Console 服务配置参考](#console-服务配置参考)
7. [Dockerfile 的角色](#dockerfile-的角色)
8. [本地开发](#本地开发)
9. [常见故障速查](#常见故障速查)
10. [历史事故复盘](#历史事故复盘)

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
├── railway.json                 ← Railway/Railpack 构建配置 ✅ 当前生效
├── nixpacks.toml                ← 仅作备份，Railpack 不读这个文件
├── Dockerfile.chat              ← Docker 构建参考（Railway 当前未使用）
└── Dockerfile.console           ← Docker 构建参考（Railway 当前未使用）
```

两个 App 均为 Next.js，均启用了 `output: 'standalone'` 模式，分别部署为独立的 Railway Service。

---

## Builder 选型：Railpack

### Railway 的 Builder 演进

Railway 早期支持 Nixpacks，2025 年底切换到了自研的 **Railpack**。两者的配置文件**完全不同，互不兼容**。

| Builder | 配置文件 | 状态 |
|---------|---------|------|
| **Railpack** | `railway.json` | ✅ **当前使用** |
| Nixpacks | `nixpacks.toml` | ⚠️ Railpack 会静默忽略此文件 |
| Docker | `Dockerfile`（根目录，精确命名） | 手动在 Dashboard 切换 |

**如何确认当前 Builder：** 查看 Railway 的 Build Log，若出现 `using build driver railpack-v0.x.x` 或 `[railpack] merge ...`，就是 Railpack。

> ⚠️ **坑点**：`nixpacks.toml` 放在 repo 任何位置都无效——Railpack 不读它。如果你修改了 nixpacks.toml 并 redeploy，配置不会生效。

---

## 当前配置文件详解

### `railway.json`（根目录）

```json
{
  "$schema": "https://schema.railway.app/railway.schema.json",
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

**Build 阶段逐步说明：**

| 步骤 | 命令 | 作用 |
|------|------|------|
| 1 | `npx prisma generate ...` | 生成 Prisma Client（类型安全的 DB 访问层） |
| 2 | `npm run build -w apps/chat` | 执行 `next build`，产出 `.next/standalone/` |
| 3 | `cp -r apps/chat/.next/static ...` | 将静态资源复制到 standalone 的正确位置（详见下节） |

**Start 阶段逐步说明：**

| 步骤 | 命令 | 作用 |
|------|------|------|
| 1 | `npx prisma db push ...` | 将 Prisma schema 同步到 Railway Postgres |
| 2 | `node .../apps/chat/server.js` | 启动 Next.js standalone 服务器 |

> **注意**：`railway.json` 目前只配置了 **chat** 服务。`railway.json` 不支持多服务配置，Console 服务的命令需在 Railway Dashboard 的 Service Settings 里单独设置（参考 [Console 服务配置参考](#console-服务配置参考)）。

---

## 关键知识：Monorepo Standalone 路径

这是本项目最容易踩的坑，单独拎出来强调。

### Standalone 输出路径在 Monorepo 中不同于单项目

Next.js 官方文档通常以单项目为例，standalone 入口是：
```
.next/standalone/server.js   ← 单项目
```

但在 **npm workspaces monorepo** 里，`server.js` 在 workspace 的子路径下：
```
apps/chat/.next/standalone/
  apps/
    chat/
      server.js        ← ✅ 真正的入口
      .next/           ← 服务端 build 产物（页面、路由等）
      public/          ← 静态资源（已自动复制进来）
  packages/
    shared/            ← 依赖的 workspace 包（自动复制）
  node_modules/        ← 精简后的运行时依赖（自动复制）
  package.json
```

**从 repo 根目录（`/app`）运行的正确命令：**
```bash
node apps/chat/.next/standalone/apps/chat/server.js
```

### 为什么 `.next/static` 要手动复制？

Next.js standalone 模式**不会**自动将静态资源（CSS、JS chunks）打包进 standalone 目录，需要手动复制。

`server.js` 在 `__dirname` 相对路径下查找静态资源：
```
server.js 位置：apps/chat/.next/standalone/apps/chat/server.js
__dirname：     apps/chat/.next/standalone/apps/chat/
查找静态资源：  apps/chat/.next/standalone/apps/chat/.next/static/
```

因此 build 阶段需要：
```bash
cp -r apps/chat/.next/static \
      apps/chat/.next/standalone/apps/chat/.next/static
```

`public/` 目录 Next.js 会自动处理，不需要手动复制。

---

## 必须设置的环境变量

### Chat 服务（Railway Dashboard → chat service → Variables）

| 变量 | 示例值 | 说明 |
|------|--------|------|
| `HOSTNAME` | `0.0.0.0` | **⚠️ 必须设置**，见下方说明 |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | 主 Agent 调用 |
| `DEEPSEEK_API_KEY` | `sk-...` | Composer Assist（访客输入续写） |
| `DATABASE_URL` | `postgresql://...` | Railway Postgres 自动注入 |
| `NEXT_PUBLIC_APP_URL` | `https://intera-chat.up.railway.app` | 公开访问地址 |
| `NEXT_PUBLIC_CHAT_API_URL` | `https://intera-chat.up.railway.app` | Chat API 地址 |

### `HOSTNAME=0.0.0.0` 为什么是必须项

这个变量**不是业务配置，是基础设施配置**。

**不设时的问题链：**
1. Railway 会把容器 hostname（如 `ab126f93c2d7`）注入为 `HOSTNAME` 环境变量
2. Next.js standalone 读取 `process.env.HOSTNAME`，并只在该 hostname 上监听
3. Railway 的反向代理尝试通过 `0.0.0.0` 路由流量，连接失败
4. **结果：Railway Dashboard 显示服务 Online，但公网所有请求返回 502**

**设置后：** Next.js 监听 `0.0.0.0:$PORT`，Railway 反向代理正常路由，公网 200 ✓

---

## Console 服务配置参考

Console 服务目前在 **Railway Dashboard → console service → Settings** 中手动配置，不走 `railway.json`。

如果需要重新配置（迁移到新项目、服务重建等）：

**Build Command：**
```bash
npx prisma generate --schema=./packages/shared/prisma/schema.prisma \
  && npm run build -w apps/console \
  && cp -r apps/console/.next/static \
            apps/console/.next/standalone/apps/console/.next/static
```

**Start Command：**
```bash
npx prisma db push \
  --schema=./packages/shared/prisma/schema.prisma \
  --accept-data-loss --skip-generate \
  && node apps/console/.next/standalone/apps/console/server.js
```

**同样必须设置** `HOSTNAME=0.0.0.0`，以及 console 服务自身的 API keys。

---

## Dockerfile 的角色

`Dockerfile.chat` 和 `Dockerfile.console` **当前不被 Railway 使用**（Railpack 在生效）。

保留它们的用途：
- **本地 Docker 构建**：`docker build -f Dockerfile.chat -t intera-chat .`
- **紧急回退方案**：若 Railpack 出现严重问题，可在 Railway Dashboard → Service → Settings → Build → Builder 切换为 Docker，并指定 Dockerfile 路径

**Dockerfile 与 Railpack 的路径差异：**

Dockerfile 在 `COPY --from=builder /app/apps/chat/.next/standalone ./` 后，standalone 内容（包括 `apps/chat/server.js`）被展开到 WORKDIR `/app`，所以 entrypoint.sh 里用的是：
```bash
exec node apps/chat/server.js  # 相对于 /app
```

而 Railpack 不复制文件，runtime 保留完整目录树，所以用的是：
```bash
node apps/chat/.next/standalone/apps/chat/server.js  # 完整路径
```

两者的 `server.js` 是同一个文件，只是运行目录不同。

---

## 本地开发

```bash
# Chat 开发服务器（port 3000）
npm run dev -w apps/chat

# Console 开发服务器（port 3001）
npm run dev -w apps/console

# Case Continuation Worker
npm run worker:continuation -w apps/chat

# Prisma Studio 数据库 UI（port 5555）
npm run db:studio -w packages/shared
```

IDE 启动配置已写入 `.claude/launch.json`（Fleet / VS Code 可直接读取）。

---

## 常见故障速查

遇到部署问题时，先对照错误信息查这张表：

### `sh: next: not found`

**原因：** start 命令是 `next start`，但 `output: 'standalone'` 模式下不打包 `next` binary。

**修复：** 使用 `node apps/chat/.next/standalone/apps/chat/server.js`，不要用 `next start`。

---

### `Error: Cannot find module '...standalone/server.js'`

**可能原因 A：Build 步骤没有运行**

检查 Build Log 里是否有 `next build` 的输出。如果只看到 `npm ci`，说明 build 命令没有被执行。

排查：
- 确认 `railway.json` 在 repo 根目录，且 `buildCommand` 字段非空
- 查看 Build Log 开头是否有 `using build driver railpack`

**可能原因 B：路径写错了**

Monorepo 中 server.js 的路径是 `standalone/apps/chat/server.js`，不是 `standalone/server.js`。

参考「[关键知识：Monorepo Standalone 路径](#关键知识monorepo-standalone-路径)」章节。

---

### 服务显示 Online / SUCCESS，但公网返回 502

**原因：** `HOSTNAME` 环境变量未设置或设置错误，Next.js 没有监听 `0.0.0.0`。

**修复：** 在 Railway Dashboard → chat service → Variables 中添加 `HOSTNAME=0.0.0.0`，然后触发 redeploy。

> 如何区分「服务崩溃」和「HOSTNAME 问题」：查看 Runtime Log，若有 `✓ Ready in Xms` 却依然 502，就是 HOSTNAME 问题；若日志里有 crash/exit，就是服务本身崩溃。

---

### 改了 `nixpacks.toml` 没有生效

**原因：** Railway 现在用 Railpack，不读 `nixpacks.toml`。

**修复：** 把配置改到 `railway.json` 的 `buildCommand` / `startCommand` 字段。

---

## 历史事故复盘

### 背景

2025-05，Chat 服务在 Railway 上反复崩溃，经历了三轮不同的故障。

---

### 第一轮：`next: not found`

**时间：** 2025-05-22

**现象：**
```
sh: next: not found
npm error code 127
```

**根因：** `apps/chat/package.json` 的 start 脚本是 `"start": "next start"`，但 `next.config.js` 配置了 `output: 'standalone'`，standalone 模式下 `next` binary 不会被打包进运行时，也不会在 PATH 里。

**修复：** 将 start 脚本改为 `node .next/standalone/apps/chat/server.js`（当时路径还不对，后来第二轮再修正）。

---

### 第二轮：`Cannot find module`（两个子问题）

**时间：** 2025-05-25

**现象 1：**
```
Error: Cannot find module '/app/apps/chat/.next/standalone/server.js'
```

**根因 1：** 项目原本有 `apps/chat/nixpacks.toml`，以为 Railway 会用 Nixpacks 来 build。实际上 Railway 已切换到 Railpack，完全忽略了 `nixpacks.toml`，Build 阶段只做了 `npm ci`，没有运行 `next build`，导致 `.next/` 根本不存在。

**修复 1：** 添加 `railway.json` 并在 `buildCommand` 中明确写出构建命令。

**现象 2（修复 1 之后）：** 报错路径变成了 `.../standalone/server.js`，但文件实际在 `.../standalone/apps/chat/server.js`。

**根因 2：** 没有意识到 monorepo workspace 的 standalone 输出路径不同于单项目——`server.js` 在 workspace 路径下，不在 standalone 根目录。

**修复 2：** 本地实际检查了 standalone 目录结构后确认正确路径，同时补上 `cp .next/static` 步骤。

---

### 第三轮：Online 但 502

**时间：** 2025-05-25（同一天，第二轮修完之后）

**现象：** Railway 显示 `● Online`，Deployment 状态为 `SUCCESS`，Runtime Log 显示 `✓ Ready in 140ms`，但公网所有请求返回 `502 Bad Gateway`。

**排查过程：**

1. 检查服务状态：Online ✓，不是崩溃
2. 检查 Port：Next.js 绑定在 8080（Railway 注入的 PORT）✓
3. 检查 Runtime Log 中的监听地址：`- Local: http://ab126f93c2d7:8080`、`- Network: http://ab126f93c2d7:8080`

关键发现：Network 地址是容器 hostname 而不是 `0.0.0.0`，说明 Next.js 只监听了容器内部 hostname，Railway 代理无法路由。

**根因：** Railway 会将容器 hostname 注入为 `HOSTNAME` 环境变量。Next.js standalone server 读取 `process.env.HOSTNAME`（默认 `0.0.0.0`），被 Railway 注入的 hostname 覆盖，导致服务只绑定到容器内部 hostname。

**修复：** 在 Railway Variables 中显式设置 `HOSTNAME=0.0.0.0`，触发 redeploy，公网恢复 200 ✓。

---

### 完整的正确部署链路

```
git push / railway up
  │
  ▼ Railpack 读取 railway.json
  │
  ├─ Build 阶段
  │    1. npx prisma generate      → 生成 Prisma Client
  │    2. npm run build -w apps/chat → next build，输出 .next/standalone/
  │    3. cp .next/static → standalone/apps/chat/.next/static
  │
  ├─ 生成 runtime 镜像
  │    └─ 包含 apps/chat/.next/standalone/ 完整目录树
  │
  └─ Start 阶段（容器内）
       1. npx prisma db push       → 同步 schema 到 Postgres
       2. node .../apps/chat/server.js  → 启动 Next.js
          │
          └─ 绑定到 0.0.0.0:$PORT（因为 HOSTNAME=0.0.0.0）
             │
             └─ Railway 反向代理路由 → 公网 200 ✓
```
