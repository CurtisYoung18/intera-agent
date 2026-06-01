# 鉴权部署检查清单

> 在对外放量前必须完成。每项按序执行。

## 1. Railway 环境变量

在 Railway 项目中新增：

```bash
# 必需 — bridge 自调用 /api/messages 的内部密钥
# 生成方式: openssl rand -hex 32
INTERNAL_API_SECRET=<random-64-char-hex>

# 可选 — 覆盖内置 api org 默认密码（不设则 api org 无密码，仅 API key 鉴权）
API_ORG_PASSWORD=<strong-password>

# 确认项 — bridge 自调用 URL（默认 localhost:3001，同进程部署不需要改）
# INTERNAL_CHAT_API_URL 默认值已改为 localhost:3001，通常不需要设置
```

## 2. 数据库

```bash
# 部署时自动执行（见 railway.json startCommand）:
npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate

# 确认 ApiKey 表已创建:
npx prisma studio  # 或直接查 DB: SELECT * FROM api_keys;
```

## 3. 生成第一把 Org API Key

部署后，通过 Console 管理后台生成：

```
1. 登录 Console (https://<console-url>/admin)
2. 进入 BUILD → API Keys（或直接访问 /api/admin/api-keys）
3. 点击 "Generate Key"
4. 复制明文 key（只显示一次！）
5. 设置 LiveChat webhook 指向 console
```

或通过 API（curl）：
```bash
# 用 Console cookie 会话
curl -X POST https://<console-url>/api/admin/api-keys \
  -H 'Content-Type: application/json' \
  -H 'Cookie: intera_auth=1; intera_org_id=<org-id>' \
  -d '{"name":"livechat-production"}'
# Response: { "key": {...}, "plaintext": "intera_sk_live_..." }
```

## 4. LiveChat Webhook 切换

```
当前: webhook → apps/chat (port 3000, 即将下线)
目标: webhook → apps/console (同域名，不同 service 或无变化)

步骤:
1. Login to LiveChat Developer Console
2. 确认 webhook URL 指向 console 的 /api/livechat/webhook/<orgId>
   （如果 console 与 chat 同域名同端口，webhook URL 不变）
3. 验证 bridge 使用的 INTERNAL_CHAT_API_URL 默认值 localhost:3001
   （同进程部署不需要修改，bridge 自调用同实例）
```

## 5. 端到端验证（蓝绿并行）

```
□ console 与 chat 并行部署（两个 Railway service，或同 service 双端口）
□ 生成一把 org API key（步骤 3）
□ 从 LiveChat 发送一条真实消息
□ 确认消息处理链路: webhook → bridge → /api/messages (auth gate 通过) → agent 回复 → LiveChat
□ 检查日志: 无 401 Unauthorized
□ 检查 /api/health 返回 200
□ 稳定观察至少一个业务周期（建议 24h）
□ 确认零异常后，下线 chat service
□ rm -rf apps/chat（参见 migration spec A6）
```

## 6. 回滚

```
□ 如果 console 出现阻塞问题:
  1. LiveChat webhook 指回 chat service
  2. git checkout <pre-migration-tag> 重新部署 chat
  （数据库零变更，秒级可逆）
```

## 7. 后续

- [ ] PR #2: 删除 apps/chat
- [ ] Phase B: UI 重构 (InteraLogo / Playground / Dashboard / 侧边栏)
