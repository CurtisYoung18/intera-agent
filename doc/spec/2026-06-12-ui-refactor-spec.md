# Intera Console UI Refactor Spec - 2026-06-12

**Last updated:** 2026-06-12  
**Status:** active focused supplement; append new owner-approved UI rework items here before implementation begins  
**Audience:** founder, architect, UI/UX lead, frontend lanes, AI coding teams  
**Base design system:** [`Intera_UI_UX_Design_System.md`](./Intera_UI_UX_Design_System.md)  
**Related implementation-truth audit:** [`../archive/retired-handoffs/COMPONENT_TRUTH_AUDIT_2026-06-10.md`](../archive/retired-handoffs/COMPONENT_TRUTH_AUDIT_2026-06-10.md)

This document captures owner-approved UI refactor decisions that are more specific than the global design system and are intended to be implemented later as one grouped construction pass.

It is a **living batch spec**:

- add new owner-marked UI surfaces here before implementation starts
- do not treat this file as implemented truth yet
- when this file conflicts with the current shipped UI for the scoped surfaces below, this file wins
- when this file conflicts with the broader design system, this file wins only for the explicitly scoped surfaces below

---

## 0. Hard rules for this batch

1. This batch is UI/UX and information-architecture work only. Do not reopen runtime, schema, API contract, or procedure-engine architecture just to satisfy these visuals.
2. Accepted preview images archived under `.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/` are the visual acceptance reference for the scoped regions below.
3. Annotated source screenshots archived under `.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/` explain what problem each redesign is solving and must remain linked from this spec.
4. If implementation must choose between preserving a legacy UI affordance and matching the accepted preview for the same scoped region, prefer the accepted preview unless the owner explicitly reopens the decision.
5. Keep the approved Intera light-first `Quiet Agent Studio` language: warm light surfaces, restrained accents, calm density, low card pressure, and minimal implementation-facing jargon.
6. Do not describe product surfaces with implementation terms such as `route`, `page component`, or `preview proof` in ordinary operator-facing UI when a simpler product phrase works.
7. This batch is intentionally incomplete. More UI issues may be appended before build. Do not start broad construction until the owner says the collection pass is complete.

---

## 1. Reference artifact archive

Archive root:

- [`.artifacts/ui-refactor/2026-06-12-owner-accepted/`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/)

Annotated inputs:

- [`playground-trace-model-response-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/playground-trace-model-response-annotated.png)
- [`procedures-list-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/procedures-list-annotated.png)
- [`components-hub-initial-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/components-hub-initial-annotated.png)
- [`procedure-detail-authoring-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/procedure-detail-authoring-annotated.png)
- [`components-hub-compress-no-route-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/components-hub-compress-no-route-annotated.png)
- [`integrations-channels-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/integrations-channels-annotated.png)
- [`integrations-api-keys-source.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/integrations-api-keys-source.png)
- [`integrations-livechat-config-source.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/integrations-livechat-config-source.png)
- [`brain-pilot-direction-reference.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/brain-pilot-direction-reference.png)
- [`brain-live-playwright-source.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/brain-live-playwright-source.png)
- [`pilot-live-playwright-source.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/pilot-live-playwright-source.png)
- [`playground-live-playwright-reference.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/playground-live-playwright-reference.png)

Accepted previews:

- [`playground-trace-model-response-evidence-module.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/playground-trace-model-response-evidence-module.png)
- [`procedures-list-workspace-table.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/procedures-list-workspace-table.png)
- [`components-hub-lightweight-index-no-route-language.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/components-hub-lightweight-index-no-route-language.png)
- [`procedure-detail-pure-authoring-full-width.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/procedure-detail-pure-authoring-full-width.png)
- [`integrations-suite-selected-board.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/integrations-suite-selected-board.png)
- [`integrations-overview-workspace-selected.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/integrations-overview-workspace-selected.png)
- [`integrations-api-keys-empty-state-selected.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/integrations-api-keys-empty-state-selected.png)
- [`integrations-livechat-config-desk-selected.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/integrations-livechat-config-desk-selected.png)
- [`brain-pilot-selected-board.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/brain-pilot-selected-board.png)
- [`brain-model-selected.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/brain-model-selected.png)
- [`pilot-lab-pilot-selected.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/pilot-lab-pilot-selected.png)

Acceptance rule:

- The archived preview is not a moodboard. It is the acceptance reference for the named surface.
- Small implementation differences are acceptable when driven by real product data, i18n expansion, or responsive constraints.
- Structural differences are not acceptable when they reintroduce the exact layout problem called out in the annotated source screenshot.

---

## 2. Confirmed redesign items

### UIR-01 Playground trace sidebar - model response becomes an evidence module

**Surface**

- `Build -> Pilot Lab -> Playground`
- right trace sidebar, `Model response` region

**Problem to remove**

- the current area reads like a raw trace/log snippet rather than a human-readable evidence node
- prompt inspection sits outside the card-like result area
- the region lacks the same receipt-quality hierarchy used elsewhere in the runtime desk

**Owner-approved redesign direction**

- keep the trace sidebar
- keep the scoped `Model response` region
- redesign it as a compact evidence module that summarizes the outcome first
- keep prompt inspection inside the same composed module rather than as a detached link

**Must remove**

- raw snippet feel
- detached `Show prompt data` link
- overly developer-facing phrasing for the primary result line

**Must preserve**

- runtime-truth framing
- token, latency, model, and stop-reason visibility
- access to prompt/messages/tools inspection

**Acceptance reference**

- input: [`playground-trace-model-response-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/playground-trace-model-response-annotated.png)
- target: [`playground-trace-model-response-evidence-module.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/playground-trace-model-response-evidence-module.png)

**Likely implementation files**

- `apps/console/components/playground/trace-sidebar.tsx`
- `apps/console/components/playground/trace-sidebar.test.tsx`

**Acceptance checklist**

- the region reads as one composed evidence block
- the top line states the model outcome in plain language
- model, stop reason, latency, and token counts remain visible
- prompt inspection is visually inside the module, not detached below it

### UIR-02 Procedures list - remove icon-catalog behavior and procedure-type framing

**Surface**

- `Build -> Components -> Procedures`

**Problem to remove**

- the page still feels like a legacy `Procedure Type` catalog
- the list page includes an editor-state version context bar that does not belong to browse mode
- arbitrary icon values leak directly into the UI and can render as text-like junk
- card tiles add decorative weight without adding real clarity

**Owner-approved redesign direction**

- reframe the page as a cleaner `Procedures` workspace list
- remove the version context editing bar from the list page
- remove per-item icon dependence from the list
- move from decorative tiles toward a calmer structured list/table workspace

**Must remove**

- `Procedure Types` framing on the list page
- list-page editing-context bar
- custom icon pressure for each procedure item
- any visible junk/icon-string rendering such as `lock`, `history`, or similar text-like icon leaks

**Must preserve**

- create, search, enable/disable, delete, open
- step count, max turns, and enabled/routing state
- Components local navigation

**Acceptance reference**

- input: [`procedures-list-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/procedures-list-annotated.png)
- target: [`procedures-list-workspace-table.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/procedures-list-workspace-table.png)

**Likely implementation files**

- `apps/console/app/build/components/procedures/page.tsx`
- `apps/console/components/admin/version-context-bar.tsx`

**Acceptance checklist**

- page title and copy say `Procedures`, not `Procedure Type`
- the list page does not show the editing-context version bar
- no procedure row depends on a custom icon to remain legible
- the browse surface feels like a workspace list, not a card catalog

### UIR-03 Components hub - compress header, remove explanation cards, and remove route language

**Surface**

- `Build -> Components` hub page

**Problem to remove**

- the hub currently feels like an internal migration memo or explanation page
- oversized top copy and side explanation cards add noise
- the launcher teaches `route`/`入口` semantics rather than behaving like a module index

**Owner-approved redesign direction**

- compress the hero/header area significantly
- remove the top-right explanation cards entirely
- keep only a short title and one restrained supporting line
- keep local navigation
- turn the lower section into a lightweight workspace index
- remove explicit `route` framing from user-facing language

**Must remove**

- explanation-card cluster on the upper right
- large document-like intro block
- implementation-facing `route` language
- heavy `打开入口` wording

**Must preserve**

- Components local navigation
- module-level discoverability for Brain, Procedures, Tools, Hooks, Knowledge, Integrations
- calm light-first Intera material language

**Acceptance reference**

- inputs:
  - [`components-hub-initial-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/components-hub-initial-annotated.png)
  - [`components-hub-compress-no-route-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/components-hub-compress-no-route-annotated.png)
- target: [`components-hub-lightweight-index-no-route-language.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/components-hub-lightweight-index-no-route-language.png)

**Likely implementation files**

- `apps/console/app/build/components/page.tsx`
- `apps/console/app/build/components/_components/components-route-shell.tsx`

**Acceptance checklist**

- the header is materially shorter than the current shipped version
- upper-right explanation cards are gone
- the page reads like a workspace index, not documentation
- user-facing copy does not teach `route` semantics
- entry actions use product-facing language such as `进入` or `打开`, not `打开入口`

### UIR-04 Procedure detail - pure authoring surface, no preview/simulation on this page

**Surface**

- `Build -> Components -> Procedures -> [detail]`

**Problem to remove**

- the permanent right-side preview/simulation panel competes with the authoring workspace
- the page behaves like two different tools stacked together
- the earlier design still advertised `测试 / 预览` in the authoring chrome

**Owner-approved redesign direction**

- this page becomes a pure Procedure authoring surface
- remove the entire permanent right-side preview/simulation section
- expand the left authoring surface to use the reclaimed width
- do not move `测试 / 预览` to another button in this page
- this page should not advertise that function at all

**Must remove**

- right-side preview tab
- right-side simulation tab
- top-toolbar `测试 / 预览` or equivalent affordance on this page

**Must preserve**

- title/editing context for the Procedure itself
- save, delete, close, and ordinary authoring actions
- full procedure authoring flow

**Acceptance reference**

- input: [`procedure-detail-authoring-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/procedure-detail-authoring-annotated.png)
- target: [`procedure-detail-pure-authoring-full-width.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/procedure-detail-pure-authoring-full-width.png)

**Likely implementation files**

- `apps/console/app/build/components/procedures/[name]/page.tsx`

**Acceptance checklist**

- the page has no permanent right-side preview/simulation column
- the authoring canvas uses the reclaimed width
- the top toolbar does not advertise testing/preview on this page
- the page reads as a focused authoring workspace rather than a split authoring-plus-test hybrid

### UIR-05 Integrations overview - operational channel workspace instead of blank card field

**Surface**

- `Build -> Components -> Integrations`
- default `Channels` tab

**Problem to remove**

- the page still shows a list-page editing/version bar that does not belong on this browse surface
- the top section spends too much space explaining itself instead of helping the operator act
- the main body reads like sparse generic cards placed on a blank canvas
- active and planned channels are visible, but not framed like an operational workspace

**Owner-approved redesign direction**

- remove the editing/version context bar from the overview page
- keep a compact page header with only necessary orientation copy
- redesign the channel area as a true workspace with a clear split between active channels and planned channels
- promote LiveChat and Web Chat into richer summary rows/modules with concise operational metadata
- keep the overall material language light, calm, and product-trustworthy rather than dashboard-heavy

**Must remove**

- list-page editing/version bar
- verbose explanatory paragraphing about why integrations belongs inside Build
- large empty whitespace between the tabs and the channel list
- generic repeated channel cards that read like placeholders instead of live product modules

**Must preserve**

- Components local navigation
- `Channels` and `API keys` top tabs
- visibility of active vs planned channels
- direct entry into LiveChat and Web Chat configuration

**Acceptance reference**

- input: [`integrations-channels-annotated.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/integrations-channels-annotated.png)
- suite board: [`integrations-suite-selected-board.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/integrations-suite-selected-board.png)
- target: [`integrations-overview-workspace-selected.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/integrations-overview-workspace-selected.png)

**Likely implementation files**

- `apps/console/app/build/components/integrations/page.tsx`
- `apps/console/components/integrations/integrations-workspace.tsx`
- `apps/console/components/integrations/__tests__/integrations-workspace.test.tsx`

**Acceptance checklist**

- the overview page shows no editing/version context bar
- the header is compact and does not read like documentation
- active channels feel live and operational rather than decorative
- planned channels are clearly lower-priority without feeling broken or abandoned
- the page reads as one integrations workspace instead of a blank page with a few floating cards

### UIR-06 Integrations API keys - empty state becomes a concise activation desk

**Surface**

- `Build -> Components -> Integrations`
- `API keys` tab, empty state

**Problem to remove**

- the current empty state leaves too much dead space in the center of the page
- support text and usage help read like detached documentation blocks instead of part of the product workflow
- the create action exists, but the page does not help the operator understand the next move at a glance

**Owner-approved redesign direction**

- redesign the empty state around one strong create action and a compact, productized explanation of what API keys unlock
- keep only necessary guidance and endpoint references
- balance the page so the empty state feels intentional and ready for first action
- preserve the light workspace tone while making the surface more useful before the first key exists

**Must remove**

- oversized blank center area
- long-form doc-like explanation blocks
- fragmented help content that sits far away from the create action

**Must preserve**

- top-level `API keys` tab within Integrations
- strong `create API key` action
- visibility of the essential API entry points and security framing
- ability to evolve into the non-empty list state later without changing the product IA again

**Acceptance reference**

- input: [`integrations-api-keys-source.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/integrations-api-keys-source.png)
- suite board: [`integrations-suite-selected-board.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/integrations-suite-selected-board.png)
- target: [`integrations-api-keys-empty-state-selected.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/integrations-api-keys-empty-state-selected.png)

**Likely implementation files**

- `apps/console/components/integrations/integrations-workspace.tsx`
- `apps/console/components/integrations/__tests__/integrations-workspace.test.tsx`

**Acceptance checklist**

- the empty state no longer feels like a large blank waiting room
- the create action is visually primary and immediately legible
- supporting help is concise and integrated into the surface
- endpoint/security context remains visible without turning the page into documentation

### UIR-07 LiveChat configuration - rebuild as a full configuration desk

**Surface**

- `Build -> Components -> Integrations -> LiveChat`

**Problem to remove**

- the current layout behaves like a long form dumped into the left column with a mostly empty right side
- webhook, credentials, runtime status, and utility actions are not composed into one coherent operating surface
- the page contains more explanation than necessary while still making scanning harder

**Owner-approved redesign direction**

- treat this surface as a full configuration desk, not a mild restyle of the current form
- keep the top title/actions row, but rebuild the body into a clearer operating layout
- use a compact webhook/status block, structured tabs, grouped credential modules, and a purposeful side utility/status panel
- reduce helper copy to only the essential hints needed to safely configure the channel
- make the page feel trustworthy and operation-ready the moment it opens

**Must remove**

- the old long-left-form plus empty-right-column composition
- unnecessary explanatory copy that competes with configuration tasks
- any feeling that runtime status and quick actions are secondary afterthoughts

**Must preserve**

- webhook URL visibility and copy action
- save/configure/test actions
- connection, rendering, and escalation segmentation
- core LiveChat credentials, auth mode, region, account identity, and agent identity inputs
- runtime/test state visibility

**Acceptance reference**

- input: [`integrations-livechat-config-source.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/integrations-livechat-config-source.png)
- suite board: [`integrations-suite-selected-board.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/integrations-suite-selected-board.png)
- target: [`integrations-livechat-config-desk-selected.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/integrations-livechat-config-desk-selected.png)

**Likely implementation files**

- `apps/console/components/integrations/livechat-channel-workspace.tsx`

**Acceptance checklist**

- the page no longer reads like a single stacked form with unused side space
- webhook, config, runtime status, and utility actions feel intentionally grouped
- helper text is materially shorter while the page remains operable
- the operator can visually scan credential setup, status, and next actions without hunting through the page

### UIR-08 Brain model workspace - compress repeated context and refine the existing authoring surface

**Surface**

- `Build -> Components -> Brain`
- accepted state is the `Model` section of the Brain workspace

**Problem to remove**

- the page repeats context too many times before the operator reaches real work
- the current hierarchy makes the top header, local nav, editing bar, page title, mode switcher, and large form blocks compete with each other
- the prompt editor and assembled preview read like oversized admin boxes rather than one intentional authoring surface

**Owner-approved redesign direction**

- keep the current Brain page and its actual element set, but compress and rebalance it into a calmer workspace
- use the accepted visual direction from the selected preview board without inventing new product features
- make the model controls, core prompt editor, and assembled prompt preview feel more deliberate and easier to scan
- preserve the existing light-first Intera language and the current `Model / Memory / Profile / Compact Test` sectional structure

**Must remove**

- excessive repeated context layering before the main Brain work begins
- giant blank-box feeling in the prompt and preview area
- visual weight that makes all stacked sections feel equally loud

**Must preserve**

- breadcrumb/header
- Components local navigation
- editing/version context bar
- page title and short explanatory copy
- `Model / Memory / Profile / Compact Test` section switcher
- `Save draft`
- runtime model selector
- temperature, thinking budget, max iterations, max output tokens, and extended-thinking state
- core prompt editor
- assembled prompt preview

**Hard guardrail for this item**

- do not add new operator-facing modules, metrics, cards, panels, or workflows that are not already present on the real live Brain page

**Acceptance reference**

- direction reference: [`brain-pilot-direction-reference.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/brain-pilot-direction-reference.png)
- live source: [`brain-live-playwright-source.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/brain-live-playwright-source.png)
- suite board: [`brain-pilot-selected-board.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/brain-pilot-selected-board.png)
- target: [`brain-model-selected.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/brain-model-selected.png)

**Likely implementation files**

- `apps/console/app/build/components/brain/page.tsx`
- `apps/console/components/brain/brain-workspace.tsx`
- `apps/console/components/brain/model-workspace.tsx`
- `apps/console/components/brain/__tests__/model-workspace.test.tsx`

**Acceptance checklist**

- the Brain screen reaches its primary work area faster with materially less repeated context
- no new product module is introduced beyond the current live Brain anatomy
- model controls remain complete while feeling more intentional and less box-heavy
- the prompt editor and assembled preview feel composed rather than like two oversized blank admin slabs

### UIR-09 Pilot Lab pilot - rebalance the existing cockpit without changing its anatomy

**Surface**

- `Build -> Pilot Lab`
- accepted state is the `Pilot` tab only

**Problem to remove**

- the central chat area feels underused while the right rail feels overloaded
- starter actions read like detached floating buttons rather than part of one authored cockpit
- the page has the right ingredients, but the current composition creates too much empty left-side space and too much stacked density on the right

**Owner-approved redesign direction**

- keep the current Pilot surface and its real live anatomy, but rebalance it into a cleaner chat-first cockpit
- use the accepted visual direction from the selected preview board while staying inside the existing product truth
- integrate the starter actions more naturally into the main flow
- lighten and organize the right rail so it reads as one purposeful side workspace rather than a long pile of unrelated cards

**Must remove**

- the feeling of a giant empty left canvas
- detached starter-action chip feel
- overly repetitive stacked-card rhythm in the right rail

**Must preserve**

- editing/version context bar
- `Pilot / Playground` tabs
- current agent title row with selected agent, changed-since-last-validation state, refresh, and ready state
- central conversation area
- starter action buttons / prompt suggestions
- bottom composer
- right rail sections for current context, Pilot state, current brief, current TodoPlan, latest inspection trace, handoff, proposed changes, diff viewer, and scenario controls
- existing actions such as `Generate release handoff`, `Generate proposal`, `Save scenario`, `Run runtime`, and `Fixture check`

**Hard guardrail for this item**

- do not add new operator-facing panels, metrics, timelines, evidence modules, or workflows that are not already present on the real live Pilot tab

**Explicit non-scope**

- `Build -> Pilot Lab -> Playground` is not part of this accepted redesign slice and should remain unchanged unless separately approved

**Acceptance reference**

- direction reference: [`brain-pilot-direction-reference.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/brain-pilot-direction-reference.png)
- live source: [`pilot-live-playwright-source.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/pilot-live-playwright-source.png)
- playground reference for non-scope boundary: [`playground-live-playwright-reference.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/annotated-inputs/playground-live-playwright-reference.png)
- suite board: [`brain-pilot-selected-board.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/brain-pilot-selected-board.png)
- target: [`pilot-lab-pilot-selected.png`](../../.artifacts/ui-refactor/2026-06-12-owner-accepted/accepted-previews/pilot-lab-pilot-selected.png)

**Likely implementation files**

- `apps/console/app/build/pilot-lab/page.tsx`
- `apps/console/app/build/pilot-lab/page.test.tsx`

**Acceptance checklist**

- the page still uses the same real live Pilot anatomy, with no invented modules
- the central conversation area feels more intentionally used
- starter actions feel integrated into the cockpit rather than floating
- the right rail remains complete but feels more balanced and less like an overloaded stack
- no accepted styling or layout change leaks into Playground during this slice

---

## 3. Implementation boundaries for the later construction pass

The later implementation pass for the confirmed items above should stay narrow unless the owner explicitly expands it.

**Allowed scope**

- page layout
- visible copy
- hierarchy
- spacing
- card/list/table structure
- toolbar action set
- relocation or deletion of already-visible UI affordances on the scoped pages

**Disallowed scope unless reopened**

- runtime semantics
- backend contract rename
- procedure-engine behavior
- schema changes
- API route changes
- broad navigation/IA changes outside the named surfaces

**Special guardrails**

- `Playground` trace sidebar must keep runtime-truth semantics intact while the visual module is refactored
- `Procedure detail` may delete preview/simulation from this page, but that is a product-surface decision, not permission to remove unrelated runtime/testing infrastructure elsewhere in the app
- `Brain` and `Pilot` accepted items may restyle, compress, reorder, and rebalance the existing live page anatomy, but must not invent new operator-facing modules, metrics, timelines, or workflows
- `Playground` is intentionally excluded from the accepted `Brain / Pilot` redesign slice added in `UIR-09`; do not carry those changes into `/build/pilot-lab?tab=playground` without separate owner approval

---

## 4. Acceptance method

Before implementation is declared complete for any item in this file:

1. Capture fresh screenshots of the implemented surface in the same state as the archived reference where feasible.
2. Compare the implemented screenshot against the accepted preview for the scoped region.
3. Confirm that no removed element from the `Must remove` list was reintroduced.
4. Confirm that no preserved behavior from the `Must preserve` list was silently lost.
5. Record the implementation screenshots and receipt in a new `.artifacts/delivery-audit/<date>/...` folder during the later construction pass.

This spec does **not** itself count as final acceptance. It defines the owner-approved target that the later implementation pass must match.

---

## 5. Open append section

Add future owner-approved UI refactor points below this line before construction starts.

- `pending`: more surfaces to be appended by owner review
