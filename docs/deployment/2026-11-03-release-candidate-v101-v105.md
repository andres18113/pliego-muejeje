# Release candidate: V101–V105 (identity decisions, active library, registration protection, FK indexes, SSE)

Status: **prepared, not deployed.** Branch `feat/digital-ownership-post-purchase-search`; the exact release SHA and its
green CI run are recorded at the end of this file. Deployment follows the [production runbook](production-runbook.md)
sections 4–9 with the section 7 privilege lifecycle (five pending migrations).

## Production read-only preflight (2026-11-03, 15:5x -05:00)

Run by root in the operator's `pliego-ops` tmux session holding `/run/lock/pliego-deploy.lock`, as
`runuser -u postgres -- psql -d pliego -f -` inside one `BEGIN READ ONLY … ROLLBACK` transaction with
`statement_timeout=15s`, `lock_timeout=1s`, using [`scripts/ops/release-preflight-v101-v105.sql`](../../scripts/ops/release-preflight-v101-v105.sql).
Aggregates only; the copied SQL and the output file were removed from the VPS afterwards. **Re-run it immediately
before deployment** (section 5): these are point-in-time observations.

| Check | Result |
|---|---|
| PostgreSQL / max_connections | 18.6 (pgdg24.04) / 30 |
| Flyway | max V100, 100 successful, 0 failed → V101–V105 pending |
| Runtime role | `pliego_app` schema CREATE f, database CREATE f, `pliego_owner` member f |
| Names V101–V105 create | 0 conflicting relations, 0 `trg_realtime_%` triggers |
| Activity at check time | 2 idle `pliego_app` JDBC connections, 0 ungranted locks, 0 prepared transactions |

### V103 (PPA-08) on production data

| Table | Live rows | Total size | Existing leading-key index on the V103 column |
|---|---|---|---|
| `sesion_autenticacion` | 16 | 176 kB | only the partial `ix_sesion_autenticacion_usuario_activa (usuario_id, fecha_expiracion) WHERE …` |
| `digital_ownership` | 5 | 40 kB | none on `edicion_id` alone (unique `(cliente_id, edicion_id)` leads with `cliente_id`) |

Both indexes are justified exactly as in ADR 0057 and build in milliseconds at these sizes. Flyway runs V103 inside
its transaction during backend startup, after the previous release has stopped (section 7), so the SHARE lock of an
ordinary `CREATE INDEX` meets no application writers; `CONCURRENTLY` is unnecessary (and not allowed inside the
Flyway transaction). V104's trigger creation on `pedido`, `pago`, `envio`, `pedido_retiro`, `correo_outbox`,
`digital_grant` and the correction tables takes brief SHARE ROW EXCLUSIVE locks on tables of ≤ 44 live rows.

### Data the new behaviour depends on

| Fact | Count | Effect after release |
|---|---|---|
| Correction requests | 1 APPROVED, decided within 30 days | that customer sees the approval notice once in Mi perfil; no retroactive email (ADR 0055) |
| Digital grants | 5, all REVOKED | all 5 owned identities leave Mi biblioteca (cancelled purchases); orders, refunds and grants are kept |
| Help sentences targeted by V105 | ebooks ✓, audiolibros ✓, cedula-o-ruc ✓ | V105 updates all three published articles |

## Reverse proxy and capacity

See [SSE proxy and capacity verification](../testing/2026-11-03-sse-proxy-and-capacity.md) and the runbook's SSE
section. Production Nginx (read-only, 2026-11-03): nginx 1.24.0, the API site's single `location /` with
`proxy_read_timeout 30s`, `proxy_send_timeout 30s`, `X-Forwarded-For $http_cf_connecting_ip`, default
`proxy_buffering`, `gzip on` with default `gzip_types`; 2 workers × 768 connections.

| Track | Verdict | Key evidence (local, production-equivalent limits) |
|---|---|---|
| A — reverse proxy | **GO** | nginx 1.24.0 with the exact production location: unbuffered first byte ≈ 7.7 ms, heartbeat gap ≤ 16.02 s (≈ 14 s under the 30 s read timeout), healthy 60 s close and 3 s reconnect, Last-Event-ID replay, 401/429/CORS intact, no gzip. The existing location suffices; the dedicated `location =` (runbook §8b) is recommended hardening. |
| B — capacity and recovery | **GO** | 2 CPUs, Hikari 8/2, `max_connections` 30, 256/1280 MiB: 0→128 streams with all REST 200, 4/user and 128/process caps, 10 000-hint burst with 0 lost/duplicated/misrouted, restarts and 60 s lease expiry recover. The release correction bounds all per-connection SSE database work to 4 of 8 pool slots (≤ 5 with the publisher) with 100 ms lock / 1 s statement limits: during an 8 s lease-table lock REST stays at 1.4–2.8 ms (was 1.5–3.5 s). Cost: `/orders` 127.3 → 111.6 req/s (−12 %) at 128 streams. |

Not certified locally: Cloudflare/TLS/AOP, production traffic and cardinalities, 3.8 GiB memory pressure. Seven local
full-gate attempts were invalidated by host-level native crashes (PostgreSQL MultiXact errors, OpenJDK/Temurin C1 JIT on
JDK-internal XML code) and are not counted; the authoritative full gate is GitHub CI on the release commit. Details:
[SSE proxy and capacity verification](../testing/2026-11-03-sse-proxy-and-capacity.md).

## End-to-end journeys against the real stack (local, disposable)

A disposable PostgreSQL 18 cluster (V105, `max_connections=30`) and the backend JAR built from the committed release
code (Hikari 8/2, `-Xms256m -Xmx1280m`, mail/R2/billing worker disabled), with the Vite frontend proxying to it — real
SSE, real cookies, real Database API routines; nothing mocked. Fixtures go through the public API and approved
routines (`backend/src/test/postgres18/realtime_live_fixture.py`).

| Journey | Spec | Result |
|---|---|---|
| Identity notifications: a new request, the admin's approval and the acknowledgment reach two open tabs live; reload keeps it closed; one decision email queued; hints recorded | `realtime-identity.live.spec.ts` | PASS (3 runs) |
| Order updates: an admin payment approval moves an open order page without reload | `realtime-identity.live.spec.ts` | PASS (3 runs) |
| Cancelled digital ownership: purchase, cancellation/refund, library and detail behaviour, Help | `library_checkout_http_gate.py` → `library-storefront.live.spec.ts` | PASS (gate + 2 specs) |
| Registration protection: identical 201 for new/existing address, 6th attempt 429 + Retry-After, page pauses neutrally, nothing sent while paused | `registration-protection.live.spec.ts` | PASS |
| Favorites shortcut: digital add opens the drawer, closing focuses "Ver carrito ›", persists after reload, leads to the cart | `favorites-cart-shortcut.live.spec.ts` | PASS (2 runs) |
| Existing live specs: account, session, favorites, purchase | `*.live.spec.ts` | PASS (6 tests) |
| Re-run against the **final** backend (with the SSE budget/abort correction): identity + orders live, Favorites shortcut, registration protection | three specs above | PASS (3 tests); backend log 0 ERROR/SSE warnings |

Not run, environment limits (not product failures): `offers.live` and the two `digital-physical-contract.live` tests
need the seeded development catalog and an active offers campaign; `orders-lifecycle.live` / `store-pickup.live`
need a dedicated fixture generator that is not in the repository. The same transitions are covered by the CI PG18
gates and the mocked Playwright specs.
