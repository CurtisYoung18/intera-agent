---
name: j1b-account-kyc
description: 查询账户状态和KYC身份验证状态。当用户无法登录、账户被锁、询问KYC进度时使用此 skill。
---
# J1B Account & KYC Skill

## API Base
- Base URL: `https://jayabaji.ai-chat.life`
- Method: POST
- Content-Type: `application/json`
- **Auth Header**: `apiKey: G71fGn7G8vb1T2824rr7`

## Tools

### Tool 1: get_account_status

查询账户状态。

- **Endpoint**: `https://jayabaji.ai-chat.life/v2/chatbot/account-status`
- **Timeout**: 8000ms
- **Mode**: http

**When to call**: 用户无法登录、账户被锁定、提示登录失败、账户异常时调用此工具。

**Input Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| member_id | string | Yes | 用户的 member_id |

**Request Body**:
```json
{
  "member_id": "{{member_id}}"
}
```

**Response**:
```json
{
  "data": {
    "status": "locked"
  },
  "message": "success"
}
```

---

### Tool 2: get_kyc_status

查询身份验证（KYC）状态。

- **Endpoint**: `https://jayabaji.ai-chat.life/v2/chatbot/user-kyc-status`
- **Timeout**: 8000ms
- **Mode**: http

**When to call**: 用户询问KYC进度、身份验证状态、证件认证是否通过时调用此工具。

**Input Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| member_id | string | Yes | 用户的 member_id |

**Request Body**:
```json
{
  "member_id": "{{member_id}}"
}
```

**Response**:
```json
{
  "data": {
    "kyc_status": "pending_review"
  },
  "message": "success"
}
```

---

## Decision Guide

| 用户问题 | 调用工具 |
|---|---|
| 我无法登录 | get_account_status |
| 我的账户被锁了 | get_account_status |
| 登录失败怎么回事 | get_account_status |
| 我的KYC认证进度 | get_kyc_status |
| 我的身份验证通过了吗 | get_kyc_status |
| 证件认证卡在哪个步骤 | get_kyc_status |

## Important Notes

- 所有接口都需要 `member_id`
- 如果无法获取 `member_id`，先询问用户
- `get_account_status` 的 `data.status` 可能包含：normal、locked、suspended 等值
- `get_kyc_status` 的 `data.kyc_status` 可能包含当前卡住的阶段信息