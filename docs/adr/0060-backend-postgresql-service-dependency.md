# ADR 0060 — Backend PostgreSQL service dependency

## Status

Proposed — 2026-11-13. Production rollout has
not yet been applied.

## Context

During the 2026-11-13 incident, package maintainer scripts stopped and later
started `postgresql@18-*` as separate systemd jobs. The backend's
`Requires=postgresql@18-main.service` propagated the stop to `pliego.service`.
`Restart=on-failure` never reverses a systemd-requested stop, so the later cluster
start left the backend stopped and the public API returning 502 for about
15 minutes.

## Decision

Use `Wants=network-online.target postgresql@18-main.service` and retain
`After=network-online.target postgresql@18-main.service`. Do not use a PostgreSQL
`Requires=`, `BindsTo=`, `PartOf=` or `Upholds=` dependency for the backend.
Spring continues to own transactions; this changes service lifecycle coupling
only.

## Alternatives considered

- Keep `Requires=`: rejected because a package-requested database stop would
  continue to stop the backend without automatically bringing it back.
- `BindsTo=`: rejected because it adds stronger stop coupling when PostgreSQL
  becomes inactive.
- `PartOf=`: rejected because it propagates database stop/restart operations to
  the backend and does not solve separate stop and start jobs.
- An `Upholds=` drop-in on PostgreSQL: rejected because continuous backend
  activation would interfere with intentional drains and introduce a second
  place controlling the backend lifecycle.

## Consequences

Backend startup still pulls PostgreSQL in and is ordered after its start job;
ordering does not prove database readiness. A running backend survives a
PostgreSQL stop, with Hikari connection errors during the interruption; database
requests can fail until connections recover. This does not promise uninterrupted
API availability.

`StartLimitBurst=3` within `StartLimitIntervalSec=300` can still be exhausted by
startup failures; operator recovery then requires `systemctl reset-failed pliego`
and `systemctl start pliego` after resolving the cause. Planned PostgreSQL
upgrades must still explicitly stop/drain and later start/check the backend.

## Production rollout

Not yet applied. Under the deploy lock, edit the installed unit to match the
repository, run `systemd-analyze verify` on that unit, then
`systemctl daemon-reload`. No backend restart is needed for this dependency
change. Verify the loaded dependencies before releasing the lock.
