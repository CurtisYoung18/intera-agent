# KB Search topK — Model Control Decision

**Date**: 2026-06-05
**Status**: Decision pending

## Problem

DeepSeek v4 Flash consistently passes `topK: 5` in kb_search tool calls, overriding the configured default (15) and the knowledge source's configured value. The tool schema declares `default: 15`, but the model ignores it and uses 5.

This causes sub-optimal recall — only 5 results returned instead of the configured 15.

## Options considered

### A. Server-side enforcement (Math.max)

Force `top_k = Math.max(model_input, source_config)` — the server ignores the model's value if it's lower than the source's configured minimum.

**Pros**: Guarantees minimum recall. Simple change.
**Cons**: Reduces model agency. If the model has a good reason to request fewer results (e.g., narrow query), we override it.

### B. Knowledge page toggle + better description (recommended)

Add a per-knowledge-source toggle: "Allow model to control result count". When off, the server always uses the source's configured topK. When on, the model's topK is used (clamped to 1-50).

Also improve the tool description to incentivize larger topK:
> "Number of results to return (1-50). Higher values may surface more relevant information that lower values miss. Default: 15."

**Pros**: Gives admins control. Models can still optimize when appropriate. Better description may naturally fix the 5 problem.
**Cons**: Requires UI change. More configuration surface.

## Recommendation

Option B. The description change may fix the 5 issue without any toggle. If models still under-request, the toggle provides an escape hatch per source.

## Related

- `streaming-tool-executor.ts`: GPTBots API call — `top_k` parameter
- `skills.ts`: kb_search tool schema — `topK` default definition
- Knowledge page: Source configuration UI
