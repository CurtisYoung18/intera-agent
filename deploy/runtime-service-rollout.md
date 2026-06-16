# Runtime Service Rollout

CONS-M3B introduces a separate `intera-runtime.service` process and an internal API seam. The service now defaults to direct runtime execution: internal message and close requests are handled inside the runtime process by loading the existing Console handler module, instead of HTTP-forwarding the turn back to the Console process.

## Current Mode: Direct Runtime Execution

The runtime service owns the internal API and deployment topology:

- `GET /internal/health`
- `POST /internal/cases/:caseId/messages`
- `POST /internal/cases/:caseId/close`

The runtime service starts with `tsx --tsconfig ../console/tsconfig.json` so it can load the existing TypeScript/Next handler modules while the deeper runtime-core extraction continues. `x-intera-runtime-bypass: 1` is still added to internal requests as a recursion guard, but in direct mode it protects the shared handler from proxying back into runtime; it is no longer a legacy-forward transport signal.

Set `INTERA_RUNTIME_EXECUTION_MODE=legacy-forward` only as an explicit rollback. In that mode the service forwards to Console `/api/messages` and Console `/api/internal/cases/:caseId/close`, preserving the old strangler seam.

## Host Env

Use one shared `/etc/intera/console.env` for both services:

```bash
INTERNAL_API_SECRET=<same-secret-for-console-and-runtime>
INTERA_RUNTIME_URL=http://127.0.0.1:3101
CONSOLE_INTERNAL_URL=http://127.0.0.1:3000
RUNTIME_PORT=3101
# Optional rollback only:
# INTERA_RUNTIME_EXECUTION_MODE=legacy-forward
```

`INTERA_RUNTIME_URL` enables Console and LiveChat internal calls to use the runtime service. If it is unset, Console falls back to the in-process `/api/messages` handler and LiveChat keeps calling Console directly.

The deploy script is fail-closed: when `INTERA_RUNTIME_URL` is set, `intera-runtime.service` must be installed, the runtime service restarts first, Console restarts second, Console `/api/health` must pass, and then `GET ${INTERA_RUNTIME_URL}/internal/health` must pass. In direct mode, runtime health reports the runtime process's own live session stats and must include `"mode":"direct"`. When `INTERA_RUNTIME_URL` is unset, runtime service restart is skipped for backward compatibility.

## Install

```bash
sudo cp deploy/intera-runtime.service /etc/systemd/system/intera-runtime.service
sudo systemctl daemon-reload
sudo systemctl enable --now intera-runtime.service
curl -sS http://127.0.0.1:3101/internal/health
sudo systemctl restart intera-console.service
```

Caddy must not expose `/internal/*` publicly. The repo Caddyfiles return `404` for public `/internal/*`; runtime calls should stay on loopback/private networking.

`/internal/health` in direct mode returns `{ status:"ok", mode:"direct", sessions, activeRuns, queueDepth, stats }`. If it returns `mode:"legacy-forward"`, the host is intentionally rolled back or the env still sets `INTERA_RUNTIME_EXECUTION_MODE=legacy-forward`.

## Rollback

```bash
sudo systemctl disable --now intera-runtime.service
sudo sed -i.bak '/^INTERA_RUNTIME_URL=/d' /etc/intera/console.env
sudo systemctl restart intera-console.service
```

With `INTERA_RUNTIME_URL` removed, `/api/messages` and LiveChat bridge calls use the pre-M3B Console path.

For a narrower rollback that keeps the runtime service in the request path while moving execution back to Console, set `INTERA_RUNTIME_EXECUTION_MODE=legacy-forward` and restart `intera-runtime.service`.

## Acceptance Still Required

This local preflight does not close CONS-M3B production acceptance. Production signoff still requires:

- both `intera-console.service` and `intera-runtime.service` live;
- `GET /internal/health` proof on the host with `mode:"direct"`;
- deploy-during-run receipt;
- runtime-restart-during-run receipt;
- LiveChat webhook to runtime to reply round-trip receipt;
- bundled J1B matrix re-run PASS after Wave 4.
