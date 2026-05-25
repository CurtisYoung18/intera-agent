# Railway 部署上下文

> 写给未来 AI 助手的说明文档。记录了 intera-agent monorepo 在 Railway 上的部署方式、踩过的坑以及当前的正确配置。

---

## 项目结构

```
intera-agent/          ← npm workspaces monorepo
├── apps/
│   ├── chat/          ← 客户端聊天 App（Next.js, port 3000）
│   └── console/       ← 运营控制台 App（Next.js, port 3001）
├── packages/
│   └── shared/        ← Prisma schema、共享类型、工具函数
├── package.json       ← root workspace
└── apps/chat/
    └── nixpacks.toml  ← Chat 服务的 Nixpacks 构建配置（见下文）
```

---

## Railway 部署模式：Nixpacks（不是 Dockerfile）

### 背景

Railway 支持两种构建方式：

| 方式 | 触发条件 |
|------|----------|
| **Dockerfile** | Railway 在服务根目录发现名为 `Dockerfile`（精确匹配）的文件，**或**在 dashboard 里手动指定了 Dockerfile 路径 |
| **Nixpacks** | 没有 `Dockerfile`，或者存在 `nixpacks.toml` 时 |

**关键坑**：Railway 不会自动识别 `Dockerfile.chat`、`Dockerfile.console` 这类非标准名称的文件。除非在 Railway Dashboard → Service → Settings → Build → "Dockerfile Path" 里明确填写路径，否则这些文件会被完全忽略。

我们之前在根目录放了 `Dockerfile`（内容与 `Dockerfile.chat` 完全一样），Railway 确实检测到了，但 entrypoint.sh 里的路径写错了（`node apps/chat/server.js`，而 standalone output 的正确路径是 `node server.js`），导致部署一直崩溃。

**当前决策**：全部改用 **Nixpacks**，并在 `apps/chat/nixpacks.toml` 里显式配置构建和启动命令。这样更简单、更不容易出错。

---

## Next.js Standalone 模式的正确启动命令

`apps/chat/next.config.ts`（以及 console）里配置了：

```ts
output: 'standalone'
```

standalone 模式下，Next.js 把所有依赖打包进 `.next/standalone/`，**不再需要 `next` 二进制**。

| ❌ 错误（会崩溃） | ✅ 正确 |
|---|---|
| `next start` | `node .next/standalone/server.js` |
| `npm run start`（旧脚本里调的是 `next start`） | `node apps/chat/.next/standalone/server.js`（从 monorepo root 运行时） |

历史上 `apps/chat/package.json` 里的 start 脚本曾经是 `next start`，这是 Railway crash 的根因。**已修复为** `node .next/standalone/server.js`。

---

## 当前配置文件

### `apps/chat/nixpacks.toml`

```toml
# Nixpacks config for Intera Chat (Railway Nixpacks builder)

[phases.build]
cmds = [
  "npx prisma generate --schema=./packages/shared/prisma/schema.prisma",
  "npm run build -w apps/chat"
]

[start]
cmd = "npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate && node apps/chat/.next/standalone/server.js"
```

说明：
- **build phase**：先生成 Prisma client，再构建 chat app
- **start**：先做一次 `prisma db push`（同步 schema 到 Railway 提供的 Postgres），然后启动 standalone server
- `--skip-generate`：避免 start 阶段再跑一次 generate（build 阶段已经做了）
- `--accept-data-loss`：Railway 非交互环境需要这个 flag；在开发阶段暂时可接受

### `apps/chat/package.json` start 脚本

```json
"start": "node .next/standalone/server.js"
```

这个脚本用于本地 `npm run start`，路径是**相对于 `apps/chat/`** 目录的。

---

## Railway Dashboard 配置要点

- **Root Directory**：设为 `/`（monorepo 根目录），否则 `package.json workspaces` 会找不到 `packages/shared`
- **Build Command**：留空，让 `nixpacks.toml` 接管
- **Start Command**：留空，让 `nixpacks.toml` 接管
- **Watch Paths**：如果只想在 `apps/chat/**` 或 `packages/shared/**` 有变更时才触发 chat 服务重新部署，可以在 Railway 里配置 watch paths
- **Environment Variables**（chat 服务需要的）：
  - `DATABASE_URL`：Railway 自动注入（使用 Railway Postgres plugin 时）
  - `ANTHROPIC_API_KEY`
  - `DEEPSEEK_API_KEY`（Composer Assist 用）
  - `NEXT_PUBLIC_APP_URL`
  - `NEXT_PUBLIC_CHAT_API_URL`

---

## 已删除的文件

以下文件已在 2025-05-25 清理，**不要恢复它们**：

| 文件 | 删除原因 |
|------|----------|
| `Dockerfile`（根目录） | 与 `Dockerfile.chat` 完全重复；Railway 会错误地将其识别为构建入口，而 entrypoint 路径有 bug |
| `Dockerfile.chat` | 不被 Railway 自动识别（非标准名称）；已被 Nixpacks 方案替代 |
| `Dockerfile.console` | 同上 |
| `apps/chat/entrypoint.sh` | 仅被已删除的 Dockerfile 引用；脚本里的 `node apps/chat/server.js` 路径本身也是错的 |
| `apps/console/entrypoint.sh` | 同上 |

---

## 事故复盘：2025-05 Chat 服务反复崩溃

**现象**：Railway chat 服务每次部署后立刻崩溃，日志报 `sh: next: not found`。

**根因链**：

1. 项目根目录有 `Dockerfile`（内容复制自 `Dockerfile.chat`）
2. Railway 检测到根目录 `Dockerfile`，但对其 entrypoint.sh 中的路径 `node apps/chat/server.js` 执行失败——因为 standalone 输出的 `server.js` 其实在 `/app/server.js`
3. 与此同时，chat 服务可能也在尝试 Nixpacks 路径，其中 `npm run start` → `next start` → 找不到 `next` binary（standalone 模式下 `next` 不在 `node_modules/.bin` 里）

**修复**：
1. 将 `apps/chat/package.json` 的 `start` 脚本改为 `node .next/standalone/server.js`
2. 添加 `apps/chat/nixpacks.toml`，显式指定构建和启动命令
3. 删除所有 Dockerfile 和 entrypoint.sh，消除歧义

---

## Console 服务部署

Console 服务目前**没有** `nixpacks.toml`，依赖 Railway 的 Nixpacks 自动检测。如果 console 部署也出现问题，可以参照 chat 的方式在 `apps/console/` 下添加同样的 `nixpacks.toml`，只需把路径里的 `chat` 换成 `console`：

```toml
[phases.build]
cmds = [
  "npx prisma generate --schema=./packages/shared/prisma/schema.prisma",
  "npm run build -w apps/console"
]

[start]
cmd = "npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate && node apps/console/.next/standalone/server.js"
```

---

## 本地开发

本地开发不走 Railway，直接用 npm workspace 脚本：

```bash
# Chat (port 3000)
npm run dev -w apps/chat

# Console (port 3001)
npm run dev -w apps/console

# Case Continuation Worker
npm run worker:continuation -w apps/chat

# Prisma Studio (port 5555)
npm run db:studio -w packages/shared
```

IDE 配置（`.claude/launch.json`）里也有这些配置，Fleet/其他 IDE 可以直接读取。
