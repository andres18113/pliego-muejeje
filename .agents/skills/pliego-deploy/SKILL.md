---
name: pliego-deploy
description: Prepare, execute, verify, or roll back a PLIEGO production release on the existing VPS using pinned CI-verified artifacts and the documented migration privilege lifecycle.
---

# PLIEGO production deployment

Use this repository-specific skill for release preparation, production deployment,
deployment verification and application rollback. It is not a VPS provisioning,
Cloudflare management or production-data import skill.

## Read first

1. Read the repository's [AGENTS.md](../../../AGENTS.md).
2. Read the canonical [production runbook](../../../docs/deployment/production-runbook.md)
   before preparing any remote mutation. It contains the actual commands, baseline,
   recovery procedure and acceptance criteria; do not substitute a previous chat
   transcript or an ignored, hardcoded deployment script.
3. Inspect the selected commit's workflow, configuration, migrations and affected
   features. For database work also read the [runtime privilege note](../../../docs/deployment/billing-runtime-privileges.md).

Codex can invoke `$pliego-deploy`. Claude Code can invoke `/pliego-deploy` through
the repository's `.claude/skills` entry. Other runtimes can read this file and the
runbook directly; no personal skill installation or connector is required.

## Authorization and boundaries

An instruction to deploy the requested release authorizes its ordinary preparation,
activation and verification. Honor that authorization without repeated approval
questions. This skill alone authorizes nothing: a review or documentation request
does not permit deployment. Preserve the user's explicit limits and existing secrets.
Do not commit/push, change protected infrastructure or mutate business data unless
those actions are separately within scope.

## Critical decisions

- Pin the target SHA and match its CI. Explain local/remote divergence instead of
  silently deploying another revision. Preserve user work and immutable baselines.
- Revalidate live pointers, ownership, Flyway and configuration. The last-known
  release in the runbook is a dated snapshot, not a permanent current-state claim.
- Freeze locally tested JAR/dist artifacts, compare installed migration bytes and
  transfer only necessary files through the personal `ssh -F` connection.
- Hold one exclusive deployment lock; prepare backup, private evidence, previous
  pointers and a schema-compatible rollback before activation.
- With pending migrations, the runtime may need temporary inherited `pliego_owner`
  membership. Apply Flyway through normal backend startup, **stop/drain**, reassign
  objects/grant runtime access/revoke membership, then restart and verify no CREATE
  or ownership. The failure path must perform the same cleanup. Never `SET ROLE`
  on pooled app connections or leave migration privileges enabled.
- Without pending migrations, avoid privilege changes. A frontend-only release
  should not restart the backend. Existing symlink-based publication normally
  requires no Nginx change/reload.
- Verify public behavior, privacy, queues, resources and recovery. Record whether
  checks were local, mocked, anonymous, authenticated or actually performed in
  production. Do not claim inbox receipt, invoice generation or checkout success
  from a successful public catalog request.

## Deliver

Complete the authorized deployment and its checks, or report the precise blocker
and recovery state. Provide URLs, source/release IDs, checksums, pointers, service
and migration status, important configuration/privilege changes, validation results,
backup/rollback and status/log commands. Never include credentials or customer data.
