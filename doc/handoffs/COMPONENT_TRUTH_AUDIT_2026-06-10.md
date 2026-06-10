# Build Components Truth Audit - 2026-06-10

**Lane:** `COMPONENT-TRUTH-AUDIT`  
**Repo / branch audited:** `/Users/curtis/Desktop/intera-agent` on `main`  
**Audit mode:** docs/spec sync only; no product-code refactor

---

## 1. Scope scanned

Canonical Build routes:

- `/build/components/brain`
- `/build/components/procedures`
- `/build/components/procedures/[name]`
- `/build/components/tools`
- `/build/components/hooks`
- `/build/components/knowledge`
- `/build/components/integrations`

Adjacent truth context:

- `/build/pilot-lab`
- `/build/release`

Legacy compatibility entry points:

- `/admin/model`
- `/admin/tools`
- `/admin/hooks`
- `/admin/knowledge`
- `/admin/case-types`
- `/admin/case-types/[name]`
- `/admin/guardrails`
- `/admin/playground`

Implementation files inspected include:

- `apps/console/app/build/components/**`
- `apps/console/app/build/pilot-lab/page.tsx`
- `apps/console/app/build/release/page.tsx`
- `apps/console/app/admin/{model,tools,hooks,knowledge,case-types,guardrails,playground}/**`
- `apps/console/components/{brain,release,integrations}/**`
- `apps/console/components/admin/hook-builder.tsx`

---

## 2. Current truth summary

- `Brain` is a native Build workspace and is the cleanest of the six surfaces. Model save is real, busts config cache, and emits the agent-config-updated event that Playground listens to.
- `Procedures` is native list/detail UI, but the lived experience is still a Procedure-type catalog over the legacy `case-types` contract rather than a fully renamed Procedure-first builder.
- `Tools` is native and operationally truthful about runtime-managed vs editable boundaries, but Tool-scope Hook binding is only manageable from Hooks, not from Tools itself.
- `Hooks` is inside the native Build route shell, but the actual editor is still the shared `components/admin/hook-builder.tsx` implementation and no Hook simulation surface ships on `main`.
- `Knowledge` is native and real, but it remains backend-contract-first: GPTBots connection, source CRUD, and retrieval knobs are exposed more directly than the product docs imply.
- `Integrations` is native and real, but narrower than several docs/specs imply: the top-level route is `Channels` plus `API Keys`, and Web Chat is still an embed-script/coming-soon surface.
- `Pilot Lab` is the logged-in default and correctly owns `Pilot` plus `Playground`, but `Playground` still imports the legacy `/app/admin/playground/page` implementation by design.
- `Release` correctly owns package/version actions and is not acting like a hidden ConfigPilot drawer.

---

## 3. Surface truth matrix

| Surface | Canonical route | Current purpose on `main` | Editable vs runtime-managed boundary | Main CRUD / actions actually exposed | Known legacy leakage still present | Follow-up recommendation |
|---|---|---|---|---|---|---|
| Brain | `/build/components/brain` | One native workspace for model, prompt, memory, profile, and compact test | Brain fields are editable; ProcedureRun state stays explicitly outside memory/profile authority | Save model/prompt, inspect assembled prompt, save memory/profile strategy, run compact fixture | Uses shared admin-era input primitives under the hood, but visible product language is mostly aligned | Keep as truth baseline; only reopen for prompt-surface polish or browser QA |
| Procedures | `/build/components/procedures` and `/build/components/procedures/[name]` | Native Procedure catalog plus detail editor over `/api/admin/case-types` | Procedure rows and steps are editable; legacy runtime authoring is intentionally excluded | Create, search, enable/disable, delete, edit metadata, edit steps, bind/unbind step Hooks | Visible copy still says `Procedure Type`, routing toggle still reads like a type catalog, and no step simulation panel exists | Run a focused Procedure vocabulary/polish lane without reopening runtime/schema |
| Tools | `/build/components/tools` | Native custom-tool workspace with runtime-managed, channel-managed, knowledge-generated, and custom sections | System tools are locked/read-only, channel/special tools are toggle-only, custom tools are editable | Create/edit/delete custom Tools, toggle enabled state, endpoint test, infer output schema, view runtime-managed details, toggle knowledge-derived tools | Docs still imply Tool Hook binding lives here, but the UI exposes no Tool-scope Hook binding controls | Add a narrow Tool/Hook-boundary lane: either expose Tool-scope Hook bindings here or stop promising them in product copy |
| Hooks | `/build/components/hooks` | Native Build shell around the shared Hook builder and binding manager | Hooks and bindings are editable; runtime evaluation itself is not simulated here | Create/edit/delete Hook, attach/detach bindings at agent / Procedure type / Procedure step / Tool scopes, toggle bindings | Route is native, but the editor still comes from `components/admin/hook-builder.tsx`; no Hook simulation/test panel ships | Split HookBuilder into Components-owned primitives and add a small simulation/test surface in a dedicated lane |
| Knowledge | `/build/components/knowledge` | Native GPTBots/source workspace with retrieval testing | Sources are editable; generated `kb_search_*` tools are toggle-driven from source enablement | Save GPTBots API key, bind GPTBots KBs, create/edit/delete sources, scope source to a Procedure, run retrieval tests | Backend detail `caseTypeTag` still shapes the contract, and advanced retrieval knobs remain exposed directly | Keep the current route, but consider a later delivery-facing simplification of retrieval controls |
| Integrations | `/build/components/integrations` | Native channel + API-key workspace with LiveChat detail and Web Chat embed setup | LiveChat config is editable, API keys are editable, Web Chat is partially staged rather than fully operable | LiveChat autosave, connection test, rendering preview, escalation config, API key CRUD, Web Chat embed-script copy | Top-level route is only `Channels` + `API Keys`; Web Chat still says coming soon; no richer customer widget preview ships | Keep docs honest about the current P0 boundary and reopen only for richer Web Chat/productization work |

---

## 4. Legacy entry-point truth

- Redirect-only compatibility routes:
  - `/admin/model` -> `/build/components/brain?mode=model`
  - `/admin/tools` -> `/build/components/tools`
  - `/admin/hooks` -> `/build/components/hooks`
  - `/admin/knowledge` -> `/build/components/knowledge`
  - `/admin/case-types` -> `/build/components/procedures`
  - `/admin/case-types/[name]` -> `/build/components/procedures/[name]`
  - `/admin/guardrails` -> `/build/components/hooks`
- Compatibility implementation still in use:
  - `/build/pilot-lab` `Playground` tab imports `@/app/admin/playground/page`
  - `/admin/playground` remains the compatibility implementation source for dry-run + Trace Sidebar parity

This means the current active exception list is still exactly one product surface: `Playground`.

---

## 5. Mismatch register

| ID | Severity | Mismatch | Evidence | Recommended follow-up lane |
|---|---|---|---|---|
| CTA-01 | Medium | `Procedures` is native, but the visible UX still frames the surface as a `Procedure Type` catalog instead of a cleaner Procedure workspace. | `apps/console/app/build/components/procedures/page.tsx:156-166` and `:221-228` show `caseTypes.*` copy, `New Procedure Type`, `Disable Procedure type`, and `Open this Procedure type...`; detail authoring still carries type-catalog fields in `apps/console/app/build/components/procedures/[name]/page.tsx:411-467` and `:471-495`. | `COMPONENT-PROCEDURES-VOCAB-TRUTH`: wording and information-architecture polish only, no schema/runtime rename |
| CTA-02 | Medium | Backend supports Tool-scope Hook binding, but `Tools` does not expose or even summarize that binding state. The capability only exists from `Hooks`. | `apps/console/components/admin/hook-builder.tsx:714-779` exposes `Scope -> Tool`, while `apps/console/app/build/components/tools/page.tsx:420-760` contains runtime/custom-tool sections, endpoint test, and render hints but no Hook-binding UI. | `COMPONENT-TOOLS-HOOK-BOUNDARY`: add Tool-scope Hook visibility or binding entry points, or explicitly keep that responsibility on Hooks |
| CTA-03 | Medium | `Hooks` is a native route shell, but the editor remains the shared admin-era `HookBuilder` and no Hook simulation panel exists despite prior docs/spec copy. | `apps/console/app/build/components/hooks/page.tsx:1-10` mounts `HookBuilder`; `apps/console/components/admin/hook-builder.tsx:671-779` shows create/edit/bind only with no simulation/test panel. | `COMPONENT-HOOKS-NATIVE-SPLIT`: split the builder into Components-owned pieces and add a small simulation/test surface |
| CTA-04 | Medium | `Integrations` is narrower than the active docs implied. The real shipped surface is `Channels` plus `API Keys`, and Web Chat is still embed-script-only with a coming-soon notice. | `apps/console/components/integrations/integrations-workspace.tsx:596-629` shows only `channels` and `apiKeys` tabs; `apps/console/components/integrations/web-chat-channel-workspace.tsx:23-28` and `:50-74` mark Web Chat as coming soon with only the embed script exposed. | `COMPONENT-INTEGRATIONS-WEBCHAT-P0`: either productize Web Chat further or keep docs/specs constrained to the current embed-only truth |
| CTA-05 | Low | `Pilot Lab` correctly owns `Playground`, but the tab still imports the legacy compatibility page and some visible residue from old naming remains. | `apps/console/app/build/pilot-lab/page.tsx:35` and `:372-379` import/render the legacy Playground; `apps/console/app/admin/playground/page.tsx:52`, `:61`, `:114`, `:621`, and `:757` still carry `guardrailCount`, `Refund policy test`, `skillCallId`, and rule-count residue. | `PILOT-PLAYGROUND-COPY-CLEANUP`: small copy/state cleanup only; do not rewrite the dry-run runtime in this lane |
| CTA-06 | Low | `Knowledge` is truthful, but the surface still exposes backend-centric retrieval knobs more directly than the product docs suggest. | `apps/console/app/build/components/knowledge/page.tsx:280-303` and `:695-723` still revolve around `topK`, `rerankVersion`, `docCorrelation`, and `caseTypeTag`-backed Procedure scope. | `COMPONENT-KNOWLEDGE-DELIVERY-UX`: simplify or relabel retrieval controls without touching the retrieval backend |

---

## 6. No-mismatch truths worth preserving

- `Brain` correctly propagates saved model/prompt changes toward dependent debug surfaces: save busts config cache and emits the agent-config-updated event in `apps/console/components/brain/model-workspace.tsx:144-154`.
- `Release` still owns package/version control via `apps/console/app/build/release/page.tsx:1-4`; nothing in this audit suggests moving import/export/publish actions back into Pilot or Components.
- Legacy compatibility routes in this scope are mostly clean redirect shims now; they are not active UI sources of truth apart from `Playground`.

---

## 7. Recommended next lanes

1. `COMPONENT-PROCEDURES-VOCAB-TRUTH`
   - Rename and reframe the Procedure surface away from `Procedure Type` wherever the visible UX still feels like the old CaseType builder.
2. `COMPONENT-TOOLS-HOOK-BOUNDARY`
   - Decide whether Tool-scope Hook binding belongs inside Tools, Hooks, or both, then make the UI truthful.
3. `COMPONENT-HOOKS-NATIVE-SPLIT`
   - Keep current backend contracts, but split the shared HookBuilder and add a small simulation/test affordance.
4. `COMPONENT-INTEGRATIONS-WEBCHAT-P0`
   - Either accept Web Chat as embed-only for P0 or productize it further; stop leaving docs in the middle.
5. `PILOT-PLAYGROUND-COPY-CLEANUP`
   - Clean visible residue in the compatibility Playground without reopening runtime/hotfix scope.

No code changes are required to keep the docs truthful for this lane. The right follow-up is narrow product/UI polish, not a broad rebuild.
