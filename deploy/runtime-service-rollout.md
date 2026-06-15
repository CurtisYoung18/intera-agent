# Runtime Service Rollout

CONS-M3B introduces a separate `intera-runtime.service` process and an internal API seam before the full turn handler is physically moved out of the Console process.

## Current Mode: Legacy Forward

The runtime service owns the internal API and deployment topology:

- `GET /internal/health`
- `POST /internal/cases/:caseId/messages`
- `POST /internal/cases/:caseId/close`

In this first M3B step, message execution is still forwarded to the existing Console `/api/messages` handler with `x-intera-runtime-bypass: 1`. This prevents recursive proxying while preserving the current SSE event contract. The next M3B step can move the legacy handler internals behind the runtime process without changing LiveChat or Console ingress URLs again.

## Host Env

Use one shared `/etc/intera/console.env` for both services:

```bash
INTERNAL_API_SECRET=<same-secret-for-console-and-runtime>
INTERA_RUNTIME_URL=http://127.0.0.1:3101
CONSOLE_INTERNAL_URL=http://127.0.0.1:3000
RUNTIME_PORT=3101
```

`INTERA_RUNTIME_URL` enables Console and LiveChat internal calls to use the runtime service. If it is unset, Console falls back to the in-process `/api/messages` handler and LiveChat keeps calling Console directly.

The deploy script is fail-closed: when `INTERA_RUNTIME_URL` is set, `intera-runtime.service` must be installed and `GET ${INTERA_RUNTIME_URL}/internal/health` must pass before the Console restart completes. When `INTERA_RUNTIME_URL` is unset, runtime service restart is skipped for backward compatibility.

## Install

```bash
sudo cp deploy/intera-runtime.service /etc/systemd/system/intera-runtime.service
sudo systemctl daemon-reload
sudo systemctl enable --now intera-runtime.service
curl -sS http://127.0.0.1:3101/internal/health
sudo systemctl restart intera-console.service
```

Caddy must not expose `/internal/*` publicly. The repo Caddyfiles return `404` for public `/internal/*`; runtime calls should stay on loopback/private networking.

## Rollback

```bash
sudo systemctl disable --now intera-runtime.service
sudo sed -i.bak '/^INTERA_RUNTIME_URL=/d' /etc/intera/console.env
sudo systemctl restart intera-console.service
```

With `INTERA_RUNTIME_URL` removed, `/api/messages` and LiveChat bridge calls use the pre-M3B Console path.

## Acceptance Still Required

This local preflight does not close CONS-M3B production acceptance. Production signoff still requires:

- both `intera-console.service` and `intera-runtime.service` live;
- `GET /internal/health` proof on the host;
- deploy-during-run receipt;
- runtime-restart-during-run receipt;
- LiveChat webhook to runtime to reply round-trip receipt;
- bundled J1B matrix re-run PASS after Wave 4.
