---
name: j1b-games
description: 查询推荐游戏和下注历史记录。当用户询问推荐游戏、投注记录、下注历史时使用此 skill。
---
# J1B Games & Bet History Skill

## API Base
- Base URL: `https://jayabaji.ai-chat.life`
- Method: POST
- Content-Type: `application/json`

## Tools

### Tool 1: get_recommend_games

获取推荐/热门游戏列表。

**When to call**: 用户询问推荐游戏、热门游戏、想找游戏玩时调用此工具。

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

### Tool 2: get_bet_history

查询游戏下注历史。

**When to call**: 用户询问投注记录、下注历史、游戏记录时调用此工具。

**Input Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| member_id | string | Yes | 用户的 member_id |
| from_date | string | Yes | 开始日期，格式 "YYYY-MM-DD 00:00:00" |
| to_date | string | Yes | 结束日期，格式 "YYYY-MM-DD 23:59:59" |

**Request Body**:
```json
{
  "member_id": "{{member_id}}",
  "from_date": "2026-03-12 00:00:00",
  "to_date": "2026-03-17 23:59:59"
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
| 有什么推荐的游戏 | get_recommend_games |
| 热门游戏有哪些 | get_recommend_games |
| 最近我在哪些游戏下注了 | get_bet_history |
| 我的投注记录是什么 | get_bet_history |
| 指定日期的下注情况 | get_bet_history |

## Important Notes

- 所有接口都需要 `member_id`，优先从对话上下文中获取
- 如果无法获取 `member_id`，先询问用户
- `get_bet_history` 需要日期范围参数
- 日期格式必须是 "YYYY-MM-DD 00:00:00" 和 "YYYY-MM-DD 23:59:59"
- 如果用户只提供了日期没有时间，默认开始时间为 "00:00:00"，结束时间为 "23:59:59"