# Railway 部署上下文

> 写给未来 AI 助手的说明文档。记录了 intera-agent monorepo 在 Railway 上的部署方式、踩过的坑以及当前的正确配置。**包含多次踩坑的完整复盘，请务必通读再动手。**

---

## 项目结构

```
intera-agent/          ← npm workspaces monorepo 根目录
├── apps/
│   ├── chat/          ← 客户端聊天 App（Next.js）
│   └── console/       ← 运营控制台 App（Next.js）
├── packages/
│   └── shared/        ← Prisma schema、共享类型、工具函数
├── package.json       ← root workspace
├── railway.json       ← Railway/Railpack 构建配置（当前生效）
└── nixpacks.toml      ← 备用，Railpack 不读这个文件（见下文）
```

---

## Railway 当前使用的 Builder：Railpack（不是 Nixpacks！）

### 关键区别

Railway 在 2025 年末切换到了自己的 **Railpack** builder，取代了 Nixpacks。**`nixpacks.toml` 对 Railpack 完全无效，会被静默忽略。**

| Builder | 配置文件 | 识别方式 |
|---------|---------|---------|
| **Railpack**（当前） | `railway.json` | Build log 显示 `[railpack] merge ...` |
| Nixpacks（旧） | `nixpacks.toml` | Build log 显示 `nixpacks` |
| Docker | `Dockerfile`（精确命名） | Dashboard 手动指定 |

Build log 里会出现 `using build driver railpack-v0.x.x`，这就是 Railpack。

### railway.json — 当前生效的配置（Chat 服务）

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

**注意**：`railway.json` 目前只配置了 **chat** 服务的构建。Console 服务当前通过 Railway Dashboard 手动配置了 build/start 命令，不受 `railway.json` 影响。如果 console 需要重新配置，参考下面的 Console 部分。

---

## Next.js Standalone 模式 + Monorepo：路径陷阱

### ❌ 错误认知

> "standalone 输出在 `.next/standalone/server.js`"

这是**单 repo**项目的路径。在 **npm workspaces monorepo** 中，路径完全不同！

### ✅ 正确结构

当在 workspace 项目（如 `apps/chat/`）中执行 `output: 'standalone'` 时，Next.js 会把 server.js 放在：

```
apps/chat/.next/standalone/
  apps/
    chat/
      server.js          ← 真正的入口（不是 standalone 根目录！）
      .next/             ← 服务端 build 产物
      public/            ← 公开资源（已自动复制）
      next.config.js
      ...
  packages/
    shared/              ← 依赖的 workspace 包
  node_modules/          ← 精简后的依赖
  package.json
```

从 repo 根目录（`/app`）运行的正确命令：
```bash
node apps/chat/.next/standalone/apps/chat/server.js
```

### Static 文件需要手动复制

Next.js standalone **不会**自动包含 `.next/static/`（静态资源）。必须手动复制到 `server.js` 能找到的位置：

```bash
# server.js 的 __dirname = apps/chat/.next/standalone/apps/chat/
# 它在 __dirname + '/.next/static/' 找静态资源
cp -r apps/chat/.next/static apps/chat/.next/standalone/apps/chat/.next/static
```

这一步已经包含在 `railway.json` 的 `buildCommand` 里。

---

## 必须设置的 Railway 环境变量

除了业务相关的 API key 之外，还有一个**关键的基础设施变量**：

| 变量 | 值 | 原因 |
|------|-----|------|
| `HOSTNAME` | `0.0.0.0` | **必须设置！** 不设的话 Next.js standalone 只绑定容器 hostname，Railway 的反向代理无法路由，返回 502 |
| `ANTHROPIC_API_KEY` | — | 主 Agent |
| `DEEPSEEK_API_KEY` | — | Composer Assist |
| `DATABASE_URL` | — | Railway Postgres（自动注入） |
| `NEXT_PUBLIC_APP_URL` | — | 公开 URL |
| `NEXT_PUBLIC_CHAT_API_URL` | — | Chat API 地址 |

### 为什么 HOSTNAME 很重要

不设 `HOSTNAME=0.0.0.0` 时：
- Next.js 使用 `process.env.HOSTNAME || '0.0.0.0'`
- Railway 会把容器的 hostname（如 `ab126f93c2d7`）注入为 `HOSTNAME`
- 服务只绑定到容器内部 hostname，Railway 代理无法路由
- 公网返回 502 Bad Gateway，但 Railway 显示服务"Online"

---

## Console 服务部署

Console 服务目前**不依赖** `railway.json`，它的 build/start 命令在 Railway Dashboard 里手动配置。如果需要为 console 添加配置，参考：

```json
// 如果要在 railway.json 里同时配置 chat 和 console，目前格式不支持多服务
// 只能在 Railway Dashboard → Service → Settings 里分别设置：

// Console build command:
"npx prisma generate --schema=./packages/shared/prisma/schema.prisma && npm run build -w apps/console && cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static"

// Console start command:
"npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate && node apps/console/.next/standalone/apps/console/server.js"
```

Console 服务同样需要设置 `HOSTNAME=0.0.0.0`。

---

## Dockerfile 文件说明

项目根目录保留了 `Dockerfile.chat` 和 `Dockerfile.console`，**Railway 目前不使用它们**（Railpack 在生效）。保留这些文件的用途：

1. **本地 Docker 构建参考**（`docker build -f Dockerfile.chat .`）
2. 如果未来要切换回 Docker builder（在 Railway Dashboard 手动指定 Dockerfile 路径）

Dockerfile 里的 entrypoint.sh 使用的路径是 `apps/chat/server.js`（从 WORKDIR `/app` 运行），因为 Dockerfile 把 standalone 内容复制到了 `/app`，其中 workspace 结构保留：

```dockerfile
COPY --from=builder /app/apps/chat/.next/standalone ./
# 之后 /app/apps/chat/server.js 存在
```

---

## 本地开发

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

IDE 配置（`.claude/launch.json`）里有这些配置，Fleet 可以直接读取。

---

## 事故复盘：2025-05 Chat 服务反复崩溃

### 第一轮：`next: not found`

**现象**：`sh: next: not found`

**根因**：package.json 的 start 脚本是 `next start`，但 `output: 'standalone'` 模式下 `next` binary 不在 PATH 里。

**修复**：改为 `node .next/standalone/apps/chat/server.js`（后来又进一步修正了路径）。

---

### 第二轮：`Cannot find module '.../standalone/server.js'`

**现象**：`Error: Cannot find module '/app/apps/chat/.next/standalone/server.js'`

**根因 1**：Railpack 没有运行 build 步骤（没有 `railway.json`），`.next/` 完全不存在。

**修复 1**：添加 `railway.json` 指定 buildCommand。

**根因 2**（更新后仍然报错）：server.js 的路径错了。在 monorepo standalone 输出中，server.js 在 `standalone/apps/chat/server.js`，不是 `standalone/server.js`。

**修复 2**：更正路径为 `node apps/chat/.next/standalone/apps/chat/server.js`，并在 build 时把 static 复制到正确位置。

---

### 第三轮：部署 SUCCESS 但 502

**现象**：Railway 显示 Online / SUCCESS，但公网返回 502 Bad Gateway。

**根因**：`HOSTNAME` 环境变量未设置，Railway 自动注入容器 hostname（如 `ab126f93c2d7`），Next.js standalone 只绑定到该 hostname，Railway 的反向代理无法通过 `0.0.0.0` 路由到它。

**修复**：在 Railway 环境变量中设置 `HOSTNAME=0.0.0.0`。

---

### 最终正确的完整链路

```
Railway 接收到 push/upload
  → Railpack 读取 railway.json
  → 执行 buildCommand（prisma generate → next build → cp static）
  → 生成 runtime 镜像（包含 apps/chat/.next/standalone/）
  → 启动 startCommand（prisma db push → node .../apps/chat/server.js）
  → Next.js 绑定到 0.0.0.0:$PORT（因为 HOSTNAME=0.0.0.0）
  → Railway 反向代理路由到容器 → 公网 200 ✓
```
