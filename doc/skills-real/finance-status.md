---
name: j1b-finance-status
description: 查询用户存款状态、取款状态、和交易历史。当用户询问充值是否到账、取款进度、交易记录时使用此 skill。
---
# J1B Finance Status Skill

## API Base
- Base URL: `https://jayabaji.ai-chat.life`
- Method: POST
- Content-Type: `application/json`

## Tools

### Tool 1: check_latest_withdrawal_status

查询用户最新取款状态。

**When to call**: 用户询问取款进度、取款是否到账、取款状态时调用此工具。

**Input Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| member_id | string | Yes | 用户的 member_id |
| gmt | string | No | 时区，默认 "-04:00" |

**Request Body**:
```json
{
  "member_id": "{{member_id}}",
  "gmt": "-04:00"
}
```

**Response**:
```json
{
  "time_passed": 3600,
  "created_at": "2026-05-19T10:00:00Z",
  "status": "pending"
}
```

---

### Tool 2: check_latest_deposit_status

查询用户最新存款状态。

**When to call**: 用户询问存款是否到账、存款进度时调用此工具。

**Input Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| member_id | string | Yes | 用户的 member_id |
| gmt | string | No | 时区，默认 "-4:00" |

**Request Body**:
```json
{
  "member_id": "{{member_id}}",
  "gmt": "-4:00"
}
```

**Response**:
```json
{
  "time_passed": 1800,
  "created_at": "2026-05-19T09:30:00Z",
  "status": "completed"
}
```

---

### Tool 3: get_transaction_history

查询用户的存款或取款历史记录（最近5条）。

**When to call**: 用户询问交易记录、充值记录、提现记录时调用此工具。

**Input Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| member_id | string | Yes | 用户的 member_id |
| method | string | Yes | "deposit" 或 "withdraw" |

**Request Body**:
```json
{
  "member_id": "{{member_id}}",
  "method": "deposit"
}
```

**Response**:
```json
{
  "data": [],
  "message": "success"
}
```

---

## Decision Guide

| 用户问题 | 调用工具 |
|---|---|
| 我的最新存款到账了吗 | check_latest_deposit_status |
| 我的最新取款进度 | check_latest_withdrawal_status |
| 最近有哪些存款记录 | get_transaction_history(method=deposit) |
| 最近有哪些取款记录 | get_transaction_history(method=withdraw) |

## Important Notes

- 所有接口都需要 `member_id`，优先从对话上下文中获取
- 如果无法获取 `member_id`，先询问用户
- `gmt` 参数可不传，使用默认值