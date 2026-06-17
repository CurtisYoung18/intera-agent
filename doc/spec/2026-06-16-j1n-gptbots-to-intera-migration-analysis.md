# J1N GPTBots To Intera Migration Analysis

**Date:** 2026-06-16
**Status:** analysis / migration design reference
**Source:** `/Users/curtis/Desktop/J1N.bot`
**Target:** Intera Harness architecture for the same J1N customer-service project

This document analyzes how the GPTBots J1N FlowAgent is configured and how its behavior should migrate into Intera. The goal is not to clone the old Flow canvas. The goal is to preserve the working business semantics while replacing old FlowAgent compensating mechanisms with Intera's stronger Harness primitives: Tools, dynamic Knowledge tools, Procedures, Hooks, HumanTask, Scenario receipts, Trace, and the single ProcedureRun Agent.

The source `.bot` was validated with `gptbots-agent-skill/scripts/validate_gptbots_config.py` and passed. Secrets and authentication values are intentionally excluded from this document.

## Visual Assets

- [Architecture comparison](./assets/j1n-flowagent-to-harness-architecture.png)
- [Advantage scorecard](./assets/j1n-flowagent-to-harness-scorecard.png)
- [中文架构对比图](./assets/j1n-flowagent-to-harness-architecture-zh.png)
- [中文优势总结图](./assets/j1n-flowagent-to-harness-scorecard-zh.png)

---

## 1. Executive Verdict

J1N in GPTBots is a `botType=Flow` FlowAgent, not a simple prompt bot.

The old architecture uses:

- a canvas classifier to select knowledge bases before answering
- multiple Dataset nodes that fan into one large "with tools" LLM
- a long monolithic SOP prompt that tries to encode role, language, tools, business process, examples, and negative examples in one place
- side-path transfer logic through a Condition node, Message node, and Human Service node
- a deterministic VIP branch that bypasses the bot and transfers to human service

In Intera, these should not become another static Flow graph. Intera should replace them with:

- dynamic `kb_search_*` Tools instead of a static classifier-to-KG matrix
- typed HTTP Tools instead of prompt-only API rules
- Procedures that dynamically inject only the relevant SOP context
- Hooks for hard rules before/after Tool use and before customer-visible replies
- `create_human_task` / channel handoff as first-class action truth, not text that later has to be interpreted
- Scenarios as executable examples, not token-heavy examples embedded in every turn

This is the core advantage of Intera as a newer Harness architecture: it turns old FlowAgent prompt/edge workarounds into typed, traceable, testable runtime primitives.

---

## 2. GPTBots J1N Source Shape

### 2.1 Top-level bot facts

- `name`: `J1N`
- `botType`: `Flow`
- top-level `prompt`: empty
- real core prompt location: Flow component `47`, `LLM`, title `with tools`
- core prompt size: about 19.7k characters
- short-term memory: enabled, 10 rounds
- long-term memory: disabled at top level
- Tools/plugins: enabled
- workflow: disabled at top level
- response format: text
- user properties:
  - `user_id`: member id, sample value starts with `JAYA`
  - `vip`: numeric VIP level, default `0`

### 2.2 Flow components

The Flow has 17 components:

| Type | Count | Purpose |
|---|---:|---|
| `Input` | 1 | user entry |
| `Regular` | 1 | deterministic VIP branch |
| `Branch` | 1 | LLM intent classifier |
| `Dataset` | 8 | knowledge retrieval groups |
| `LLM` | 1 | main answer model with tools |
| `Condition` | 1 | LLM-based escalation classifier |
| `Message` | 1 | transfer notice before human handoff |
| `Human` | 2 | LiveChat human handoff terminals |
| `Output` | 1 | final answer endpoint |

### 2.3 Runtime topology

```text
User Input
  -> Regular: vip >= 15?
      -> true:
          -> Human handoff
      -> false:
          -> Branch intent router
          -> abbreviations Dataset
          -> escalation Condition

Branch intent router
  -> Promotion Dataset + General Dataset
  -> Deposit/Withdrawal Datasets + General Dataset
  -> Account Dataset + General Dataset
  -> Game Dataset + General Dataset
  -> Other: All Dataset + General Dataset
  -> Exception: Human handoff

All Dataset result/no-result branches
  -> Main LLM "with tools"
  -> Output

Escalation Condition true or Main LLM exception
  -> Nepali transfer Message
  -> Human handoff
```

Important: the non-VIP path fans out in parallel. The Branch path, abbreviations retrieval path, and escalation Condition path all run off the same user input. This is a FlowAgent workaround for three different runtime needs: knowledge selection, auxiliary recall, and transfer detection.

---

## 3. What GPTBots Is Really Encoding

### 3.1 Static knowledge routing

The `Branch` node classifies user input into broad buckets:

- promotion
- deposit / withdrawal
- account
- game
- other
- exception

Those branches then select one or more Dataset nodes:

- `General`
- `Game`
- `All`
- `Account`
- `Deposit`
- `Promotion`
- `Withdrawal`
- `abbreviations`

This is not business process. It is a static routing workaround: choose which knowledge source to retrieve before the main LLM runs.

### 3.2 One large "with tools" prompt

The main LLM prompt contains:

- highest-priority language and formatting rules
- Jayabaji/J1N role and tone
- Romanized Nepali quality rules
- member id rules
- timezone / `gmt` parameter rules
- tool-calling SOPs for promotion, deposit, withdrawal, turnover, reset PIN, account status, game recommendation, transaction history, bet history, and KYC
- anti-hallucination rules
- screenshot handling rules
- examples and bad examples
- final reminders

This is an overloaded prompt. It mixes stable identity, operational process, Tool contracts, business policy, negative examples, and regression tests in one blob. That makes every customer turn pay the token cost for SOPs that may be irrelevant to the active issue.

### 3.3 Transfer-to-human workaround

GPTBots has two human-transfer paths:

- `vip >= 15` in the deterministic `Regular` node goes directly to Human Service.
- `Condition-2` checks semantic escalation conditions, then sends a Nepali transfer message and enters Human Service.

The Condition prompt checks cases such as:

- repeated unresolved issue in the same conversation
- explicit complaint about AI/bot after AI already participated
- explicit request for live/human support after AI has participated
- valid screenshot or sensitive transaction/account/identity evidence

In the old FlowAgent model, human transfer is a canvas endpoint. In Intera it should be a first-class Tool action with persisted evidence and channel handoff.

---

## 4. Why Intera Is Architecturally Better Here

### 4.1 Classifier + multiple KGs becomes dynamic `kb_search_*`

GPTBots uses a Branch classifier because the Flow needs to decide which Dataset nodes to run before the main answer LLM. That introduces fixed edges, duplicated General KG branches, and brittle broad categories.

Intera already has a better primitive: each enabled Knowledge source becomes an Agent-callable `kb_search_*` Tool.

That means:

- the Agent can search the exact source it needs at the moment it needs it
- multi-intent messages can call multiple KB Tools without pre-splitting the user text through a static canvas
- adding or removing a knowledge source does not require rewiring a Flow graph
- retrieval becomes visible in Tool traces and Scenario receipts
- Procedure and Hooks can constrain when knowledge is mandatory without hiding Tool schemas
- token load improves because irrelevant Dataset outputs are not automatically merged into the main LLM context

Migration principle:

```text
Do not rebuild GPTBots Branch -> Dataset edges.
Create J1N knowledge sources and let the Agent dynamically call kb_search_* Tools.
Use Procedures/Hooks/Scenarios to make required retrieval behavior testable.
```

### 4.2 Prompt SOP becomes Procedure context engineering

The biggest migration gain is moving the SOP blocks out of the monolithic "with tools" prompt.

GPTBots does this:

```text
Every turn:
  stable identity
  + all tool SOPs
  + all business rules
  + all examples
  + all bad examples
  + short-term memory
  + retrieved knowledge
  + user input
```

Intera should do this:

```text
Stable core prompt:
  identity, language, boundaries, output rules

Active Procedure overlay:
  only the SOP for the current issue

ProcedureRun tail:
  current step, required evidence, blockers, latest tool evidence

Tool descriptions:
  parameter schema and endpoint-specific constraints

Hooks:
  hard checks before Tool use, after Tool result, and before reply

Scenarios:
  examples and bad examples as executable regression tests
```

This is better than only "shorter prompt". It gives better prompt locality:

- stable identity remains cache-friendly
- only active Procedure instructions are injected
- dynamic state stays at the prompt tail
- Tool parameter rules live with the Tool
- hard policy lives in Hooks rather than natural-language reminders
- examples stop consuming tokens on every turn
- contradictions become easier to detect because rules are separated by owner

So yes: putting many GPTBots SOP blocks into Intera Procedures is more useful for token efficiency and model prompt load, but the deeper advantage is that Procedure context is executable runtime context, not just more prompt text.

### 4.3 Text/keyword transfer becomes `create_human_task`

Old FlowAgent patterns often have the answer model or a side classifier produce a phrase, route, or branch that eventually reaches Human Service. That makes transfer partly text-shaped and partly canvas-shaped.

Intera has a better semantic action:

```text
Agent or Hook decides escalation is required
  -> call create_human_task
  -> persist HumanTask with evidence
  -> channel adapter transfers LiveChat/API conversation
  -> Scenario receipt records humanTransfer/tool call
```

This solves several old problems at once:

- transfer is no longer inferred from output text
- the customer-visible transfer promise can be blocked by a Stop Hook until `create_human_task` has actually succeeded
- the human operator receives structured context: request, Procedure type, Procedure progress, missing facts, Tool evidence, Hook decisions, and recommended next action
- validation can assert `create_human_task` was called instead of checking for fragile wording

Migration principle:

```text
Do not use fixed transfer phrases as the source of truth.
Use create_human_task as the action truth, and let the channel renderer produce the visible transfer message.
```

### 4.4 Prompt rules become Hooks where they are hard rules

GPTBots relies heavily on prompt reminders:

- only call member tools when member id starts with `JAYA`
- pass `gmt="5:45"` for some endpoints
- do not pass `gmt` for other endpoints
- do not disclose unsupported status claims
- do not promise transfer unless appropriate
- do not answer outside Jayabaji scope

In Intera, these should be split:

- soft style/boundary rules stay in the Brain prompt
- parameter prerequisites become `PreToolUse` Hooks
- Tool result validation becomes `PostToolUse` Hooks
- customer-visible safety becomes `Stop` Hooks

This is stronger because Hooks are evaluated at runtime with structured context. They can block, warn, or escalate, and their decisions appear in Trace and Scenario receipts.

### 4.5 Examples become Scenarios

GPTBots includes good and bad examples inside the main prompt. That helps behavior, but it is expensive and hard to measure.

Intera should convert those examples into Scenario Lab cases:

- expected Tool calls
- required phrases
- forbidden phrases
- expected human transfer
- expected final status
- knowledge-hit expectations
- Hook decision expectations

This makes examples reusable as regression tests instead of static prompt ballast.

---

## 5. J1N Target Design In Intera

### 5.1 Brain / core prompt

Keep the core prompt small and stable:

- role: Jayabaji/J1N customer-service Agent
- default language: Romanized Nepali unless the user clearly writes Devanagari Nepali
- tone: friendly, concise, local customer-service style
- platform boundary: only Jayabaji support
- output: plain text, no Markdown tables/lists unless the target channel explicitly supports it
- evidence: do not invent platform rules, balances, transaction states, KYC states, or promotion eligibility
- member id: use a verified `JAYA...` id from session/profile/chat before account-specific Tools

Do not put every endpoint SOP and every example into the core prompt.

### 5.2 Knowledge sources

Create or map these Knowledge sources:

- `general`
- `promotion`
- `deposit`
- `withdrawal`
- `account`
- `game`
- `all` only if there is a real cross-category fallback source
- `abbreviation_mapping` only if actual abbreviation content exists

The GPTBots export contains Dataset IDs and tuning values, but not the actual knowledge content. Intera migration needs the source content or a live connector to the GPTBots knowledge base. The `abbreviations` Dataset has no bound doc groups in the export, so it should not be treated as migrated until content is recovered.

### 5.3 HTTP Tools

J1N business APIs should be ordinary typed HTTP Tools:

- promotion eligibility/list
- latest deposit status
- withdrawal condition / bonus turnover
- latest withdrawal status
- active promotion turnover
- reset withdrawal PIN
- account status
- recommended games
- transaction history
- bet history
- KYC / ID verification details

Tool schemas and descriptions should own endpoint parameters. Do not rely on a giant prompt to remember parameters.

### 5.4 Procedures

Recommended first J1N Procedures:

| Procedure | Main purpose | Typical Tools / Knowledge |
|---|---|---|
| `deposit_not_credited` | check latest deposit and explain next step | latest deposit status, transaction history, deposit KB |
| `withdrawal_status` | check withdrawal state and missing requirement | withdrawal condition, latest withdrawal status, withdrawal KB |
| `withdrawal_turnover_condition` | explain bonus / turnover needed before withdraw | withdrawal condition, promotion/turnover KB |
| `promotion_eligibility` | answer current promotion availability and eligibility | promotion Tool, promotion KB |
| `reset_withdrawal_pin` | reset withdrawal PIN with safety checks | reset PIN Tool, account KB, optional handoff |
| `account_access_or_lock` | explain login/account lock/state | account status Tool, account KB |
| `kyc_status` | check ID verification state | KYC Tool, account/KYC KB |
| `game_recommendation` | recommend games for user | recommend games Tool, game KB |
| `transaction_history` | inspect deposit/withdraw history | transaction history Tool |
| `bet_history` | inspect betting summary/range | bet history Tool |
| `general_faq` | answer non-account-specific platform questions | dynamic KB search |

Keep the first launch set small enough to avoid routing ambiguity. Procedures should be soft guidance, not rigid node-by-node Flow recreation.

### 5.5 Hooks

Recommended J1N Hooks:

| Hook | Checkpoint | Purpose |
|---|---|---|
| `require_verified_jaya_member_id` | `PreToolUse` | block member-specific Tools until member id starts with `JAYA` |
| `j1n_gmt_parameter_contract` | `PreToolUse` | enforce which Tools require `gmt="5:45"` and which must not receive `gmt` after the schema conflict is resolved |
| `no_status_claim_without_tool_evidence` | `Stop` | block account/deposit/withdraw/KYC status claims without fresh Tool evidence |
| `knowledge_before_general_policy_answer` | `Stop` or `PostToolUse` | require KB evidence before answering general policy/promotion/rules questions with specific numbers |
| `human_transfer_requires_human_task` | `Stop` | block transfer-like prose unless `create_human_task` has persisted evidence |
| `vip_15_or_above_handoff` | discovery / `PreToolUse` / Procedure entry | preserve the GPTBots VIP direct-handoff policy |
| `reset_pin_safety_gate` | `PreToolUse` | gate reset PIN action behind verified member id and any required confirmation/handoff policy |

Hooks should be concise and structured. They replace hard prompt reminders, not the whole agent prompt.

### 5.6 Human transfer

Use `create_human_task` as the canonical transfer action.

The human task payload should include:

- customer request
- active Procedure
- current Procedure step
- missing facts
- Tool evidence
- knowledge hits if relevant
- Hook decisions
- recommended human next action

Once handoff succeeds, the ProcedureRun should be finalized according to the current Intera architecture decision. The surrounding chat/case may remain in a waiting-human channel state, but the Procedure should not pretend it is still actively resumable by the AI.

---

## 6. Source Conflicts To Resolve Before Migration

### 6.1 `gmt` conflict

The GPTBots prompt says some Tools require `gmt="5:45"` and some should not receive `gmt`. Prior OpenAPI fragments indicate at least one history endpoint may require `gmt` in schema.

This must be resolved before Scenario validation. In Intera, the Tool schema and `PreToolUse` Hook should agree. A Tool should not require a parameter that the Brain prompt forbids.

### 6.2 Deposit/status disclosure conflict

The main GPTBots prompt contains deposit/status handling SOPs, but its final reminder also includes a privacy-style restriction against disclosing some registration/deposit status information. That is a contradiction.

Intera should split this into explicit policy:

- what status can be disclosed to a verified member
- what requires human transfer
- what must never be disclosed
- what can be answered only at a generalized KB level

### 6.3 Screenshot section contains editor residue

The screenshot-handling block appears to include instructions copied from another region and warns that placeholders should be replaced before going live. This should not be migrated verbatim.

Convert it into either:

- a screenshot Procedure with clear evidence requirements, or
- a Hook that escalates sensitive screenshots to human review.

### 6.4 GPTBots plugin references are not full Tool specs

The `.bot` export contains plugin references, not full OpenAPI definitions. Intera should continue to use the actual OpenAPI fragments and HTTP Tool definitions as source of truth.

### 6.5 Knowledge content is not fully present in the `.bot`

The `.bot` gives Dataset structure and doc group references, not necessarily the actual documents. Intera migration requires either:

- importing the real GPTBots knowledge content, or
- connecting Intera Knowledge to the GPTBots knowledge API, or
- manually rebuilding J1N knowledge sources from customer docs.

---

## 7. Scenario Suite For Fair GPTBots vs Intera Comparison

Use Scenario Lab to compare behavior, not only screenshots.

Suggested seed member ids for J1N tests:

- `JAYA1197202`
- `JAYA1108F7C`
- `JAYA117FFEB`

Recommended scenarios:

| Scenario | Expected Intera evidence |
|---|---|
| User asks general promotion question | `kb_search_promotion` and/or promotion Tool, no account status claim without member id |
| User asks if they can get a specific promotion | promotion eligibility Tool with verified member id |
| User reports deposit not credited | `start_procedure(deposit_not_credited)`, latest deposit Tool, optional transaction history Tool, no unsupported promise |
| User reports withdrawal pending | withdrawal condition Tool and latest withdrawal status Tool |
| User asks ambiguous "turnover" question | both promotion turnover and withdrawal condition paths considered or clarified |
| User asks reset withdrawal PIN | verified member id, reset PIN Tool only after safety gate |
| User has account/login issue | account status Tool, account KB if explaining general steps |
| User asks game recommendation | game recommendation Tool and/or game KB |
| User repeats unresolved issue 3+ times | `create_human_task` expected |
| User explicitly asks for live human after AI tried | `create_human_task` expected |
| User uploads transaction/account screenshot | screenshot handling Procedure or human-transfer Hook expected |
| User writes in Romanized Nepali | Romanized Nepali answer |
| User writes in Devanagari Nepali | Devanagari Nepali answer |
| Multi-intent question: deposit + promotion | multiple Tool/KB calls are allowed without static Flow branch rewiring |

Comparison metrics:

- answer correctness
- correct Tool selection
- unnecessary Tool calls avoided
- knowledge retrieval relevance
- human handoff correctness
- prompt/token load
- trace explainability
- Scenario pass/fail receipt
- operator effort to modify the config

---

## 8. Migration Plan

### Phase 1: Preserve source semantics

- Keep this document as the source analysis.
- Extract the core prompt into sections:
  - keep in Brain
  - move to Procedure
  - move to Tool description/schema
  - move to Hook
  - move to Scenario
  - discard or rewrite

### Phase 2: Build Intera J1N draft

- Create/verify J1N AgentConfig.
- Add HTTP Tools from the OpenAPI fragments.
- Add Knowledge sources or connector references.
- Add Procedures for the major support intents.
- Add Hooks for member id, gmt, status evidence, handoff truth, and reset PIN safety.
- Add Scenario suite using the test member ids.

### Phase 3: Validate against GPTBots

- Run equivalent conversations in GPTBots and Intera.
- Capture Intera Scenario receipts and traces.
- Compare not just answer text, but Tool calls, knowledge hits, handoff action, and evidence.

### Phase 4: Package

- Export `.intera-agent.json` only after Scenario receipts are usable.
- Keep secrets as placeholders or secret refs.
- Record unresolved source conflicts in the package notes.

---

## 9. Bottom Line

J1N's GPTBots FlowAgent is valuable as a behavior specimen, not as an architecture template.

The correct Intera migration is:

```text
Business intent from GPTBots
  -> Intera Brain for stable identity
  -> Intera Tools for typed backend actions
  -> Intera Knowledge for dynamic kb_search
  -> Intera Procedures for issue-specific SOP context
  -> Intera Hooks for hard runtime policy
  -> Intera HumanTask for real handoff
  -> Intera Scenarios for examples and regression proof
```

This is why Intera should outperform the old FlowAgent architecture on the same J1N project: it does less static routing, carries less irrelevant prompt, produces better trace evidence, and makes business controls enforceable instead of merely suggested in a giant prompt.
