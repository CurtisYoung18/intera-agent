---
name: j1b-promotion-turnover
description: 查询活动优惠、打码量要求和提现条件。当用户询问流水、打码量、提现要求、优惠活动时使用此 skill。
---
# J1B Promotion & Turnover Skill

## API Base
- Base URL: `https://jayabaji.ai-chat.life`
- Method: POST
- Content-Type: `application/json`

## Tools

### Tool 1: get_promotion_active_status

查询当前生效的流水优惠活动。

**When to call**: 用户询问有哪些优惠活动、当前有哪些流水优惠时调用此工具。

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
  "data": [],
  "message": "success"
}
```

---

### Tool 2: get_withdraw_condition

查询打码量提现条件。

**When to call**: 用户询问打码量是否足够、提现需要多少流水、打码量要求时调用此工具。

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
  "data": [],
  "message": "success"
}
```

---

### Tool 3: get_promotion_eligible_status

查询用户可参与哪些优惠活动。

**When to call**: 用户询问如何参与活动、如何领取优惠、有什么优惠可以领时调用此工具。

**Input Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| member_id | string | Yes | 用户的 member_id |
| language | string | No | 语言，默认 "en-bd" |

**Request Body**:
```json
{
  "member_id": "{{member_id}}",
  "language": "en-bd"
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
| 我现在有哪些优惠活动 | get_promotion_active_status |
| 我的打码量够了吗 | get_withdraw_condition |
| 提现需要多少流水 | get_withdraw_condition |
| 我可以参与哪些优惠 | get_promotion_eligible_status |
| 怎么领取优惠奖励 | get_promotion_eligible_status |

## Important Notes

- 所有接口都需要 `member_id`，优先从对话上下文中获取
- 如果无法获取 `member_id`，先询问用户
- `language` 参数可不传，使用默认值 "en-bd"