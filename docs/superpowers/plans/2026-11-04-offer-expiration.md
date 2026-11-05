# Offer expiration implementation plan

Scope and design: ADR0058; user explicitly authorized investigation, choice and implementation.
Work in the requested workspace, preserving its unrelated dirty files. Do not commit.

1. Reproduce the blocked-checkout expiry defect on disposable PostgreSQL 18, port
   55441. Add SQL boundary and concurrent/recovery gates. Save raw output under
   `.release-evidence/2026-11-04/offers/`.
2. Add V106 only: explicit pricing-time helpers and new-order timestamp, checkout
   consistency and accepted-quote guard, allowlisted public realtime hints,
   durable transition observation, refresh clock and status/failure routines.
3. Add thin catalog JDBC/service/controller and Spring scheduler, structured logs
   and tests; preserve existing private SSE behavior. Add public refresh contract.
4. Run complete relevant Java and PostgreSQL SQL/concurrency/HTTP gates serially;
   generate OpenAPI and frontend shared API types/Zod only. Record API amendment,
   test evidence and monitoring bindings. Review diffs and constraints.
