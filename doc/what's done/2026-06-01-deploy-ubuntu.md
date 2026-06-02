# 部署 spec：自建 Ubuntu 服务器（取代 Railway）

> 目标机：`43.134.51.138`（Ubuntu，公网 IP）。**全新部署、无现有流量** → 不需要蓝绿/切流。
> 模型：**单机 = Console(Next standalone) + 本地 PostgreSQL + Caddy(反代+自动TLS)**。
> 本文取代 [2026-06-01-deploy-auth-checklist.md](doc/to-do/2026-06-01-deploy-auth-checklist.md) 的 Railway 部分；`railway.json` 仅留作参考，可后续删。

---

## 0. 🔴 前置阻断项（开工前必须解决）

1. **改 SSH 密码 + 换密钥登录**：当前密码已在明文渠道暴露，视为已泄露。登录后立即 `passwd`，上传公钥（`ssh-copy-id`），改 `/etc/ssh/sshd_config`：`PasswordAuthentication no` + `PermitRootLogin no`，`systemctl restart ssh`。
2. **🔴 域名（LiveChat 的硬依赖）**：LiveChat webhook 要求**受信 HTTPS**，裸 IP 无法签受信证书。**必须有一个域名 A 记录指向 `43.134.51.138`**（二级域名即可，如 `agent.yourdomain.com`）。没有域名 = LiveChat 收不到消息，整条客户通道不通。本文以 `$DOMAIN` 指代。

---

## 1. 服务器基线

> **网络拓扑（已确认）**：公网 `43.134.51.138` 经腾讯云 NAT → 内网 `172.22.16.7`。SSH(22) 能通说明 NAT 转发正常，但 **80/443 入站默认被腾讯云安全组挡住**（本机 iptables 全 ACCEPT、UFW 关闭，所以瓶颈在云端安全组，不在机器上）。

**🔴 先在腾讯云控制台放行入站**（否则 Let's Encrypt 签证书的 HTTP-01 校验打不到机器、LiveChat 也连不上）：
```
腾讯云控制台 → 该实例 → 安全组 → 入站规则 → 添加：
  TCP:80   来源 0.0.0.0/0   （Let's Encrypt 证书校验 + HTTP→HTTPS 跳转）
  TCP:443  来源 0.0.0.0/0   （HTTPS + LiveChat webhook）
  TCP:22   建议收窄到你的办公 IP（当前若是 0.0.0.0/0 应收紧）
不要放行 3000(app) / 5432(pg) 到公网——它们只在本机被 Caddy/应用访问。
```

```bash
# 以 sudo 用户执行
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl ufw build-essential

# 本机防火墙（与云安全组双层）：只开 SSH/HTTP/HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Node 20 LTS（Next 15 + React 19 需 Node >=18.18，用 20 稳）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs
node -v   # 期望 v20.x

# 专用运行用户（不要用 root 跑 app）
sudo useradd -r -m -s /bin/bash intera || true
```

---

## 2. PostgreSQL（同机本地）

```bash
sudo apt -y install postgresql
sudo -u postgres psql <<'SQL'
CREATE USER intera WITH PASSWORD 'CHANGE_ME_STRONG_DB_PW';
CREATE DATABASE intera OWNER intera;
GRANT ALL PRIVILEGES ON DATABASE intera TO intera;
SQL
```

`DATABASE_URL`（本地、不经公网）：
```
postgresql://intera:CHANGE_ME_STRONG_DB_PW@localhost:5432/intera?schema=public
```
> 确认 `postgresql.conf` 的 `listen_addresses` 保持 `localhost`，`pg_hba.conf` 不放开外网。Postgres 不对公网开。

---

## 3. 取码 + 构建

```bash
sudo -iu intera
git clone <repo-url> ~/intera-agent && cd ~/intera-agent
git checkout main            # 9899c74 (Phase A + 鉴权)

npm ci                       # 按 package-lock 精确安装

# Prisma client
npm run db:generate

# 构建 console（standalone）
npm run build:console

# 把 static + public 拷进 standalone 产物
#   注意：Railway 原命令只 cp 了 static，漏了 public → 这里一并补上
cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static
cp -r apps/console/public       apps/console/.next/standalone/apps/console/public
```

⚠️ **Prisma + standalone 已知坑**：Next standalone 用 nft 追踪文件，偶尔漏掉 Prisma 查询引擎二进制。启动后若报 `Query engine library not found`，把引擎补进 standalone：
```bash
cp -r node_modules/.prisma            apps/console/.next/standalone/node_modules/.prisma
cp -r node_modules/@prisma/client     apps/console/.next/standalone/node_modules/@prisma/client
```

---

## 4. 环境变量文件 `/etc/intera/console.env`

```bash
sudo mkdir -p /etc/intera
sudo tee /etc/intera/console.env >/dev/null <<EOF
# ── 运行 ──
NODE_ENV=production
PORT=3000
# 🔴 端口对齐：bridge 自调用 /api/messages 用此 URL，必须等于上面的 PORT
INTERNAL_CHAT_API_URL=http://localhost:3000

# ── 鉴权（生产硬依赖）──
# 生成：openssl rand -hex 32
INTERNAL_API_SECRET=$(openssl rand -hex 32)
# 内置 api org 密码（不设则 api org 仅靠 API key）
API_ORG_PASSWORD=CHANGE_ME

# ── 数据库 ──
DATABASE_URL=postgresql://intera:CHANGE_ME_STRONG_DB_PW@localhost:5432/intera?schema=public

# ── LLM ──
ANTHROPIC_AUTH_TOKEN=...
ANTHROPIC_BASE_URL=...
DEEPSEEK_API_KEY=        # 可选
MINIMAX_API_KEY=         # 可选
OPENROUTER_API_KEY=      # 可选
GPTBOTS_API_KEY=         # 可选，知识库检索

# ── LiveChat ──
LIVECHAT_CLIENT_ID=
LIVECHAT_CLIENT_SECRET=
EOF

sudo chown root:intera /etc/intera/console.env
sudo chmod 640 /etc/intera/console.env   # 仅 root + intera 组可读
```
> `INTERNAL_API_SECRET` 漏设 → bridge 自调用 401 → LiveChat 全挂（`isTrustedInternalCall` fail-closed）。这是头号上线雷。

---

## 5. systemd 服务

```bash
sudo tee /etc/systemd/system/intera-console.service >/dev/null <<'EOF'
[Unit]
Description=Intera Console (Next standalone)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=intera
WorkingDirectory=/home/intera/intera-agent
EnvironmentFile=/etc/intera/console.env
ExecStart=/usr/bin/node apps/console/.next/standalone/apps/console/server.js
Restart=on-failure
RestartSec=3
# 安全加固
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now intera-console
sudo systemctl status intera-console     # active (running)
curl -s localhost:3000/api/health         # {"status":"ok"}
```

---

## 6. Caddy 反代 + 自动 TLS（推荐，SSE 友好）

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy

sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
    encode gzip
    # SSE 端点：强制立即 flush，关闭缓冲
    @sse path /api/messages /api/cases/*/stream
    reverse_proxy @sse localhost:3000 {
        flush_interval -1
    }
    reverse_proxy localhost:3000
}
EOF

sudo systemctl reload caddy
# Caddy 会自动向 Let's Encrypt 申请并续期 $DOMAIN 的证书（需 80/443 可达 + A 记录已生效）
curl -s https://$DOMAIN/api/health   # {"status":"ok"}，带有效证书
```

> **Nginx 备选**（若坚持用 Nginx）：反代 block 里必须加 `proxy_buffering off; proxy_cache off; proxy_read_timeout 3600s; proxy_set_header Connection '';`，否则 SSE 流被缓冲攒着发。证书用 `certbot --nginx`。

---

## 7. 建表 + 种子数据

```bash
cd ~/intera-agent
npm run db:push      # 建表（含 ApiKey 表）；首次无数据，--accept-data-loss 安全
npm run db:seed      # 写入默认 org / case types / skills 等
# 确认 ApiKey 表存在：
sudo -u postgres psql -d intera -c '\dt' | grep api_keys
```

---

## 8. 鉴权初始化

```bash
# 1) 浏览器登录 Console：https://$DOMAIN/admin（default org 无密码）
# 2) 生成生产 org 的 API key（明文只显示一次，立即保存）：
curl -X POST https://$DOMAIN/api/admin/api-keys \
  -H 'Content-Type: application/json' \
  -H 'Cookie: intera_auth=1; intera_org_id=<org-id>' \
  -d '{"name":"livechat-production"}'
# Response: { ..., "plaintext": "intera_sk_live_..." }
```
> 内置 `api` org 弱口令已改为 `API_ORG_PASSWORD` 注入（§4）。确认其它 org 也都设了密码或仅用 key。

---

## 9. LiveChat Webhook 接入

```
1. LiveChat Developer Console：
   webhook URL → https://$DOMAIN/api/livechat/webhook/<orgId>
2. 在 Console 的 LiveChat 配置页设置该 org 的 webhookSecret，
   并与 LiveChat 平台的 secret_key 一致（route 会比对，不一致回 401）。
3. botAccessToken / licenseId 等填入 Console LiveChat 配置。
```

---

## 10. 端到端验证清单

```
□ https://$DOMAIN/api/health → 200，证书有效（浏览器无警告）
□ 无鉴权打 POST /api/messages → 401（确认 gate 生效）
□ 带 Bearer <org-key> 打 /api/messages → 正常 SSE，且 orgId 来自 key（忽略 body.orgId）
□ 从 LiveChat 发真实消息 → 链路通：
    webhook(secret 校验) → bridge(x-intera-internal) → /api/messages(gate 通过) → agent 回复 → LiveChat
□ journalctl 中无 401 Unauthorized、无 "Query engine library not found"
□ SSE 回复是逐字/逐段到达（非一次性憋出来）→ 证明 Caddy flush 配置生效
□ 多轮对话 + dispatch_case_agent 后台 case agent 正常
```

---

## 11. 运维

```bash
# 日志
journalctl -u intera-console -f
journalctl -u caddy -f

# 重启 / 更新（拉新代码后）
cd ~/intera-agent && git pull && npm ci && npm run db:generate && npm run build:console \
  && cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static \
  && cp -r apps/console/public apps/console/.next/standalone/apps/console/public \
  && sudo systemctl restart intera-console

# 数据库备份（cron，每日）
sudo tee /etc/cron.daily/intera-pgbackup >/dev/null <<'EOF'
#!/bin/bash
mkdir -p /var/backups/intera
pg_dump -U intera -h localhost intera | gzip > /var/backups/intera/intera-$(date +\%F).sql.gz
find /var/backups/intera -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/intera-pgbackup
```

把 §11 的更新命令固化成 `scripts/deploy.sh`，避免每次手敲漏 cp public。

---

## 12. 已知坑速查

| 现象 | 原因 | 解 |
|---|---|---|
| LiveChat 不回复，日志 401 | `INTERNAL_API_SECRET` 没设 / bridge 与 gate 不一致 | §4 设上，重启 |
| LiveChat 收不到任何 webhook | 无域名/证书无效，或 webhook URL/secret 不对 | §0.2 域名 + §9 |
| 图片 404 | standalone 漏 cp `public` | §3 补 cp public |
| `Query engine library not found` | Prisma 引擎未进 standalone | §3 补 cp `.prisma`/`@prisma/client` |
| SSE 回复憋着一次性出 | 反代缓冲了流 | §6 Caddy `flush_interval -1` / Nginx `proxy_buffering off` |
| bridge 连不上自身 | `INTERNAL_CHAT_API_URL` 端口 ≠ `PORT` | §4 两者对齐 |

---

## 13. 回滚

全新部署、无现有流量 → 回滚很轻：
```
□ git checkout <上个 tag> → 重新 build + restart
□ DB：本次是全新库，回滚无历史数据负担；若已接真实流量，先 pg_dump 再操作
□ 出问题先 systemctl stop intera-console，不要让半坏状态对外
```
