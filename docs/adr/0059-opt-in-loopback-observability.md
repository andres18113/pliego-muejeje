# ADR 0059 — Opt-in loopback observability

## Status

Proposed — 2026-11-04. Local implementation and qualification only; production
activation and any monitoring service remain subject to an operator decision.

## Context

Actuator is already packaged in the backend (release V106), but the approved
default `application.yml` sets `management.server.port: -1`. Production organic
traffic is too small to size the VPS. An isolated local benchmark needs correlated
JVM, Tomcat, Hikari and SSE measurements while preserving the production default,
the Database API and Spring transaction boundaries (ADR 0054).

## Proposed decision

Add the non-default `observability` profile, selected explicitly through
`SPRING_PROFILES_ACTIVE=observability`. It binds a separate management connector
to `127.0.0.1:8081`, exposes only read-only `health`, `metrics`, and `prometheus`,
removes all other endpoint access, disables endpoint discovery and JMX exposure,
and hides health details and components. No change to the production default
configuration or application API security is required.

The profile fails startup unless `management.server.port` is explicitly present,
enabled (0–65535) and different from the configured application port (8080 when
unset), and `management.server.address` is an IPv4/IPv6 loopback **literal**.
Wildcards, non-loopback addresses, missing/blank addresses and hostnames (including
`localhost`) are rejected. Literal parsing avoids DNS queries for untrusted
operator-supplied names. A random management port 0 is allowed only when the
configured application port is different; both configured ports 0 are rejected.
The packaged opt-in values remain `127.0.0.1:8081`; the production default remains
management port -1 with the profile inactive.

Validation runs after ConfigData/profile loading and again before configuration
bean binding, covering CLI/environment overrides and late property sources.
These are existing framework-owned properties, so the early guard does not add
a second configuration-properties API or wait for an `InetAddress` binder that
could resolve a hostname first. The inactive profile adds no binding restriction.

The endpoint-aware security chain requires **both** a permitted endpoint mapping
and `request.getLocalPort()` equal to the actual management connector port.
Trusted web-server initialization events supply both actual ports; configurable
`local.*` values and forwarded host/port headers do not define this boundary.
The matcher denies requests until both separate connectors are initialized and
rejects coincident actual ports. It never falls back to an application-port
allowlist. Tests reproduced the pre-guard shared-connector issue: selecting an
external configuration without a management address and equal positive ports
made anonymous application-port health return 200. The corrected startup rejects
that configuration before a connector can expose endpoints.

The loopback connector is the access boundary: any local process, including an
SSH tunnel, can read these aggregate measurements. It is not an authenticated
multi-tenant monitoring API. Do not proxy it through Nginx or Cloudflare. Invalid
binding overrides now fail closed; endpoint/exposure overrides still require
review before activation.

Use built-in meters for JVM memory/GC/platform threads, process CPU and uptime,
HTTP request URI templates, Hikari connection use/pending/acquisition, and Tomcat
threads/connections. Enable the Tomcat MBean registry only in this profile. Use
HTTP SLO buckets at 100, 300, 800, 1500 and 3000 ms with percentile histograms off;
the exporter also emits the required `+Inf` bucket. Percentiles come from k6 raw
summaries or a backend histogram query; do not average per-instance percentiles.

Add SSE meters at the existing stream lifecycle points, without extra DB queries,
changes to permits, transactions, authorization, timeouts or emitted frames:

| Meter | Meaning and bounded tags |
| --- | --- |
| `pliego.sse.active` | Current admitted streams; no tags |
| `pliego.sse.opens` | Successful admissions; `resume=true\|false` from the parsed Last-Event-ID presence |
| `pliego.sse.rejections` | Failed admissions; `reason=limited\|unauthorized\|other` |
| `pliego.sse.closes` | Once per cleanup, including DB cleanup failure; no tags |
| `pliego.sse.reads.deferred` | Read permit not acquired within the existing 2 s wait |
| `pliego.sse.events` | Successful sends; `kind=event\|resync\|checkpoint\|heartbeat` |
| `pliego.sse.batch.events` | Distribution summary of visible events in an existing successful read |

User IDs, connection IDs, resource IDs, cookies, cursors and dynamic event names
are never meter tags. The observed batch-size summary is a delivery pressure
signal, **not** queue depth or time lag. A global cursor gap includes invisible
events belonging to other users. The existing read projection includes neither
creation timestamps nor a separate tail cursor, so a truthful backlog/time-lag
gauge cannot be computed without changing the Database API or adding queries;
neither is justified for this instrumentation-only change. Invalid Last-Event-ID
requests fail controller validation before `open` and are reflected in the
built-in HTTP metric, not the admission rejection counter.

## Prometheus registry and supply chain

Add `io.micrometer:micrometer-registry-prometheus` without a pinned version;
Spring Boot 4.1.2 manages the version. This provides the format supported by a
small remote scraper, avoiding a bespoke JSON-to-time-series adapter. It is a
pull exporter: adding it creates no network client or automatic external push.
Actuator/Micrometer core were already dependencies; the additional registry and
its resolved Prometheus Java client dependencies still add JARs, CVE review work,
startup allocation and time-series memory even with the management port disabled.
The local resolution is Micrometer registry **1.17.2** with six Prometheus Java
client **1.7.0** archives: core, config, model, exposition formats, exposition text
formats and tracer common. These seven additional JARs total **2,444,860 bytes**
(2.33 MiB) before executable-JAR compression; this is artifact size, not RSS.
The exact resolved tree, archive sizes and tests are retained under
`<evidence>/instrumentation/`; budget growth from new URI/tag combinations before
adding any further tags. Boot's stock MVC instrumentation is tested to retain URI
templates and collapse unknown paths to MVC's static-resource catch-all `/**`.

With the profile **inactive**, management port -1 and no HTTP/DB/provider work,
the coordinator measured the frozen pre-security-correction candidate on Temurin
25.0.5+8 using a live heap dump after GC and Eclipse MAT 1.17.0. The same snapshot
contains **one Prometheus registry, 110 registered meters, 104 bytes shallow size
and 17,408 bytes (17 KiB) retained exclusively by the registry's dominator**.
The startup probe counted 109 before the final GC; use the same-snapshot 110
count for the retention figure. Temporary meter-list helper frames had unwound
before the dump. Raw CSV:
`<evidence>/root/review-corrections/profile-off-clean-frame/profile-off_Query/pages/Query_Command2.csv`;
method and scope: `<evidence>/root/review-corrections/registry-profile-off.md`.

This confirms a nonzero registry cost with management disabled. Exclusive
dominator retention is **not** the full reachable heap, total incremental
dependency cost or an upper memory bound: it excludes objects also retained by
shared registries/services, class metadata, code cache, native allocations and
future traffic/cardinality growth. Do not report 17 KiB as the entire cost of
adding Prometheus or multiply it into a per-user memory estimate.

Rejected alternatives: a custom metrics controller would duplicate Actuator and
create a separate security surface; a heavyweight Prometheus/Grafana deployment
on this 2-vCPU, 3.9-GiB VPS would compete with the application and database.

## Monitoring architecture and operator approval

Start with on-demand scraping through an operator's SSH tunnel to loopback. This
uses no persistent VPS agent or local time-series disk. It provides no continuous
alerting while the operator is disconnected.

For continuous monitoring, prefer one lightweight agent scraping loopback every
15–30 seconds and sending to a hosted backend with TLS. Evaluate its binary and
hosted provider, data retention, cost, authentication and credential rotation,
agent memory/CPU/disk buffering limits, outbound destinations, and alert ownership
before approval. Set a measured resource budget and verify it on the VPS; no
fixed RSS claim is made for an unselected agent. Avoid remote JDBC exporters or
new database permissions until justified separately.

Before any production activation, an operator must approve the profile/port and
effective overrides, service restart, collection mode and interval, hosted
destination/credentials if applicable, alert thresholds and resource budget.
Verify loopback-only binding and application-port isolation after activation.
No production firewall, Nginx, environment file or systemd changes are included
in this proposal. Disable the profile and restart to remove its connector.

## Validation and consequences

**Sustained-runtime qualification remains open; normal-JIT capacity certification
is NO-GO/unverified in the local test environment.** The first local 15-VU target
attempt on Temurin 25.0.5+8 terminated in a native C2 compiler fault while compiling
the Prometheus export lambda `lambda$addDistributionStatisticSamples$0`. A later
fresh normal-JIT session also terminated in C1 tier 3 while compiling Tomcat's
`CoyoteAdapter.parsePathParameters`, on an internal relocation guarantee failure.
The second session's disposable PostgreSQL had no native ERROR/PANIC and stopped
cleanly. A successful intervening target retry does not clear these intermittent
native failures. Fatal and compiler replay records are retained under
`<evidence>/performance/crash-20261104T225134Z/`, with investigation under
`<evidence>/instrumentation/crash-diagnosis.md` and the second pair under
`<evidence>/performance/sessions/clean-parity-c2/`. Earlier unrelated C1/C2 compiler
crashes on this same local host predate this instrumentation. The captured
compile task identifies a trigger, not an established defect in Micrometer or the
new SSE meters. Passing connector/unit tests does not qualify enabling the profile
in production; resolve or explicitly accept the runtime uncertainty and validate
on a representative supported environment before that operator decision. Any
diagnostic JIT change used for local continuation must be reported as a parity
difference and is not a proposed production flag. The authorized one-flag
`-XX:TieredStopAtLevel=1` matrix is diagnostic only, without method exclusions;
another native failure is a blocker, not grounds for unbounded JVM-flag trials.

The complete diagnostic matrix subsequently closed without another native fault:
three ordinary 15-VU 600-second holds and the separate 15-stream comparison passed
raw thresholds, while a healthy 400-VU run identified a latency boundary after a
passing 250-VU run. These results characterize only the restricted C1 setup.
Normal-JIT/production capacity and profile activation remain unqualified; the
different compiler/code-cache ergonomics also preclude treating diagnostic native
memory as a normal-production memory bound. See the consolidated VPS audit and
`<evidence>/instrumentation/capacity-analysis.md` for the final evidence limits.

The captured compiler faults and discarded-session MultiXact anomalies establish
local test-host instability, not a confirmed PLIEGO defect. An unconditional
production capacity GO requires a separately authorized staging measurement on a
representative 2-vCPU/4-GiB VPS with normal production JVM settings. That remaining
validation is listed only; no staging/VPS access is authorized or performed here.

`ActuatorExposureIntegrationTest` proves the default has management port -1 and no
management connector, and anonymous/authenticated management paths on the
application connector remain 401/404. `ObservabilityProfileIntegrationTest` starts
two real loopback HTTP connectors and proves only the three endpoints are mapped,
health hides details, prohibited endpoints are 404 for an authenticated admin,
application paths stay isolated, URI tags are bounded and only the five SLO
buckets plus infinity are exported. `RealtimeMetersTest` verifies registration,
bounded tags, lifecycle accounting and deferred read metrics; the existing SSE
permit/heartbeat/shutdown tests protect behavior. Local benchmark evidence covers
resource cost and contention separately in the VPS audit.

The review correction adds `ObservabilityStartupSafetyTest` for missing/disabled/
equal ports, both random ports, wildcard/non-loopback/hostname addresses, CLI and
environment overrides, late property sources and inactive-profile behavior.
`ObservabilityManagementBoundaryTest` verifies that only the actual initialized
management port matches, forwarded server-port values cannot substitute for it,
an unrelated child context cannot supply the port, and coincident actual ports
abort initialization. Real loopback HTTP profile tests remain in the backend
suite; no production/VPS request is part of these proofs.

Tomcat thread-meter verification uses an additional fresh Java process because
Tomcat's JVM-global MBean registry cannot be re-enabled after a different test
context disabled it. This mirrors activation by application restart and avoids
weakening the thread-meter assertion or changing shared test-JVM defaults.

This is reversible application instrumentation; it introduces no schema changes
or extra SQL, and no new frontend behavior. Counters reset on process restart;
aggregate across replicas and use counter rates in monitoring. A stream lifetime
is not HTTP request latency: SSE must be filtered out of ordinary HTTP SLOs.

## References

- [Spring Boot endpoint access and exposure](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html)
- [Spring Boot metrics](https://docs.spring.io/spring-boot/reference/actuator/metrics.html)
- [ADR 0054](0054-durable-scoped-server-sent-events.md)
- [VPS audit draft](../operations/vps-audit-2026-11-04.md)
