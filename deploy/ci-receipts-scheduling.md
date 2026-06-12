# CI Receipts Scheduling

CONS-M7A makes recurring regression evidence a host responsibility. It does not assume GitHub runners or add product runtime code.

## Command

Run from the deployed repo checkout on the single host:

```bash
cd /srv/intera-agent
npm run ci:receipts
```

The script writes:

- `.artifacts/ci/<date>/<run-id>/summary.md`
- `.artifacts/ci/<date>/<run-id>/summary.json`
- `.artifacts/ci/<date>/<run-id>/scenario-receipts/*.json`
- `.artifacts/ci/<date>/<run-id>/screenshots/*.png`
- `.artifacts/delivery-audit/<date>/cons-m7a/<run-id>/summary.md`

Each run gets a timestamped `<run-id>` under the date folder so two same-day scheduled runs do not overwrite each other.

The full scheduled gate requires authenticated screenshots. Runtime-only runs with `CI_RECEIPTS_SKIP_SMOKE=1` are allowed for dry-run proof, but their summaries are `partial` and do not close the golden-loop screenshot gate.

## Cron Example

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
CI_RECEIPTS_TZ=Asia/Shanghai
SMOKE_BASE_URL=http://127.0.0.1:3001
SMOKE_EMAIL=admin@intera.local
SMOKE_PASSWORD=replace-with-host-secret

15 */6 * * * cd /srv/intera-agent && npm run ci:receipts >> .artifacts/ci/cron.log 2>&1
```

Keep secrets in the host crontab or environment file, not in the repo.

## systemd Timer Example

`/etc/systemd/system/intera-ci-receipts.service`

```ini
[Unit]
Description=Intera CI receipt bundle
After=network-online.target intera-console.service

[Service]
Type=oneshot
WorkingDirectory=/srv/intera-agent
Environment=CI_RECEIPTS_TZ=Asia/Shanghai
Environment=SMOKE_BASE_URL=http://127.0.0.1:3001
EnvironmentFile=/etc/intera/ci-receipts.env
ExecStart=/usr/bin/npm run ci:receipts
```

`/etc/systemd/system/intera-ci-receipts.timer`

```ini
[Unit]
Description=Run Intera CI receipts every six hours

[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
Persistent=true
Unit=intera-ci-receipts.service

[Install]
WantedBy=timers.target
```

Enable it on the host:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now intera-ci-receipts.timer
sudo systemctl list-timers intera-ci-receipts.timer
```

## Done Criteria

M7A scheduling is done only after two consecutive timer or cron runs produce separate bundles without a human starting the command:

```text
.artifacts/ci/<date>/<run-id-1>/summary.md
.artifacts/ci/<date>/<run-id-2>/summary.md
```

If either run fails, keep the bundle and fix the host dependency that failed. Do not replace recurring regression receipts with a manual screenshot lane.

If either run is `blocked`, inspect the bundle's `Gate Status` and `Blockers` sections. Common host blockers are missing `SMOKE_PASSWORD` / `STAFF_PASSWORD`, an unreachable `/api/health`, or `db` not equal to `connected`.
