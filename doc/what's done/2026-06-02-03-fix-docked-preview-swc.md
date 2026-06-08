> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Fix docked-preview SWC compiler bug

**Priority:** Immediate | **Risk:** Low | **Deploy:** No (build only)

## Context

Next.js SWC compiler fails with "Unterminated string constant" when JSX `className` attributes span multiple lines. `docked-preview.tsx` has at least one such case.

## Bug location

`apps/console/components/docked-preview.tsx` — search for `className` strings that span two lines (i.e., the opening `"` and closing `"` are on different lines).

## Fix

Ensure every `className="..."` is on a **single line**. If a className is long, either:
- Keep it all on one line, or
- Use a template literal with `.trim()` + `.replace(/\s+/g, ' ')`

## Steps

1. Read `apps/console/components/docked-preview.tsx`
2. Find all multi-line `className` strings
3. Collapse them to single-line
4. Verify: `npm run build:console` — must succeed (this is the proof)
5. Verify: `npx tsc --noEmit -p apps/console/tsconfig.json` — 0 errors
6. Commit
