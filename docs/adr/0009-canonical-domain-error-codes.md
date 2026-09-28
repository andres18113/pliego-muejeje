# ADR-0009: PostgreSQL SQLSTATEs are the only wire codes for domain conditions

## Status

Accepted

## Date

2026-09-27

## Context

The approved Database API (§10.1) makes the custom SQLSTATE the decision key and allows a symbolic name only in the PostgreSQL `MESSAGE`. The approved REST contract (§28.1) publishes that SQLSTATE as the Problem Details `code`, and `ApiExceptionHandler` already does so. However, the catalog tables in both baselines label the symbolic name as “Código”. The frontend read that column as the wire value and branched on names such as `INSUFFICIENT_STOCK`, which the API never emits, so availability conflicts on the edition page fell through to generic handling. `fn_cart_get` also reported cart-item unavailability with symbolic names, giving one domain condition two identifiers.

## Decision

- Each domain condition has one canonical identifier: its PostgreSQL SQLSTATE. PostgreSQL remains the only source of domain errors.
- Spring publishes the SQLSTATE unchanged as `code` and in `type`; symbolic names stay internal labels.
- Data fields that name a domain condition use the same SQLSTATE. V025 changes `fn_cart_get.unavailabilityReason` to `P2043`, `P2042`, or `P3002`.
- HTTP, authentication, JSON, Bean Validation, and the transient card check remain REST-layer errors with symbolic codes.
- Clients branch directly on the wire code; no client-side alias or normalization table is allowed.

The full catalog and the REST-layer codes are recorded in [API amendment v1.0.3](../api-amendments/0003-canonical-domain-error-codes-v1.0.3.md).

## Consequences

- A client needs one vocabulary for conflicts and for the refreshed cart that explains them.
- `unavailabilityReason` values change for any consumer that read the V016 names; the OpenAPI schema now enumerates the allowed values.
- New domain conditions must add a SQLSTATE in PostgreSQL, a `DatabaseError` entry, and a catalog row in the amendment, in that order.

## Validation

- Every `fn_raise_domain_error` call site and the `P9001` trigger map one-to-one to `DatabaseError`.
- `CartApiIntegrationTest` asserts the SQLSTATE reason and the OpenAPI enum; the PostgreSQL 18 gate exercises V025 against a live database.
