# ADR-0046: Deterministic academic invoices, delivery email and private storage port

## Status

Accepted for the requested implementation, 2026-10-27.

## Context

Simulated invoices are issued from immutable PostgreSQL snapshots and rendered asynchronously. The existing PDF was a plain monospace listing, there was no invoice-ready email, and billing reads were coupled directly to PostgreSQL `bytea`. The new document must remain an academic simulation; no output may imply that SRI authorized it.

## Decision Drivers

- Preserve invoice, purchase and generated artifact history byte-for-byte.
- Keep pricing, tax grouping, authorization and file readiness in the Database API.
- Make the PDF professional, Unicode-safe, deterministic and reviewable.
- Notify the signed-in account owner through the existing transactional outbox.
- Support private R2 storage behind an explicit configuration flag without provisioning infrastructure from the application.
- Preserve authenticated download behavior and Spanish error codes.

## Considered Options

1. Use PDFBox with explicit page and table layout.
2. Convert HTML to PDF with a browser or HTML rendering engine.
3. Keep the handwritten PDF generator and extend its text layout.

For email, enqueue the event in the database completion routine or publish it from the Java worker after completion. For storage, keep billing coupled to PostgreSQL or introduce a replaceable port.

## Decision Outcome

**Chosen option**: PDFBox 3.0.8 with embedded static Roboto fonts, the database completion routine for email enqueueing, and an `InvoiceDocumentStore` port with PostgreSQL bytea as the default and R2 activated only by `PLIEGO_R2_ENABLED=true`.

PDFBox provides embedded Unicode fonts, page and image primitives, metadata control and direct text extraction for tests without adding a browser runtime. The bundled Roboto Regular, Medium and Bold files come from the official Google Fonts `googlefonts/roboto-2` GitHub repository and include its Apache 2.0 license. Unsupported glyphs render as `?` without failing the worker. A fixed document ID, omitted creation timestamp, fixed title and producer keep output deterministic.

The renderer only formats values from the immutable claim snapshot. It does not price, aggregate, authorize or infer tax treatment. Current payment method and amount are projected at claim time from the immutable `checkout_attempt` receipt. If an older order has no receipt, the PDF shows the invoice total without inventing a payment method.

`fn_invoice_artifact_complete` enqueues `INVOICE_ISSUED:<invoiceId>` in the same transaction that first marks a simulated PDF READY. The recipient is the order owner's account email. The payload contains the account holder's name, document number and order ID, and no identification number. XML, LEGACY invoices and artifacts already READY when V084 is applied do not enqueue mail. If `pliego.mail.enabled=false`, the existing conditional worker is absent: new outbox rows stay `PENDING`, are not sent, and are not logged as sent.

The email has one action button to the stable authenticated application route `<publicUrl>/orders/<orderId>/invoice`; it never contains an R2 URL or attaches the PDF. Delivery uses the existing MailLayout and plain-text alternative.

The `InvoiceDocumentStore` port prepares artifacts before the short transactional READY completion and handles authenticated reads. PostgreSQL bytea remains the default while `PLIEGO_R2_ENABLED=false`. When enabled, the worker uploads both PDF and XML to a private R2 bucket, then stores `storage_kind`, object key, SHA-256, size and MIME type in V085 before marking the job READY. The database trigger requires exactly one durable representation: bytes for `DATABASE`, or an object key and metadata for `R2`. A failed PUT uses the existing lease fail/retry path. If PostgreSQL completion fails after a successful PUT, the content-addressed object is an orphan; the retry PUTs identical bytes to the same key and can safely complete the row.

`GET /api/v1/orders/{orderId}/invoice/files/PDF/access` (also under `/api/v1/admin/orders/{orderId}/invoice`) authorizes ownership/admin access and checks READY through the Database API before returning `{delivery,url,expiresAt}`. Its optional `disposition` query accepts `inline` (default) or `attachment`. Bytea files return `API_STREAM` with the relative PDF route carrying that disposition and `expiresAt: null`; R2 files return a 300-second-or-shorter `SIGNED_URL` whose signed response overrides set PDF content type and the matching inline or attachment filename. The existing `/files/{type}` endpoint continues streaming both PDF and XML: database bytes from PostgreSQL, R2 bytes through a private signed GET. Already-stored bytea artifacts are not rewritten or backfilled and continue to use PostgreSQL.

`PLIEGO_R2_ENABLED` defaults to false. When enabled, the eight `PLIEGO_R2_*` values are validated and secrets are redacted from `toString`; incomplete configuration fails startup with a Spanish message. R2 signing is JDK-only SigV4, configured region default `auto`, service `s3`, path style `https://<account-id>.r2.cloudflarestorage.com/<bucket>/<key>`. The worker signs PUT headers with the payload SHA-256; GET URLs sign `response-content-type` and `response-content-disposition`. `PLIEGO_R2_PRESIGN_TTL_SECONDS` accepts 1–300 seconds. PUT retries are safe because each object key is `<key-prefix><invoiceId>/<sha256>.pdf` or `.xml`. The signing code is tested against AWS's published S3 GET and PUT vectors.

Production R2 values must be added by the operator to `/etc/pliego/pliego.env`; this implementation does not alter any environment file or provision a bucket. Keep R2 enabled while R2-backed rows exist. Turning it off leaves PostgreSQL bytea writes active but makes existing R2-backed rows unavailable until R2 is re-enabled or a future bytea backfill has been performed. Historical bytea artifacts do not need R2 configuration.

## Consequences

### Positive

- New PDFs have consistent PLIEGO identity, bordered tables, repeated item headers, a visible academic disclaimer and page footers.
- Email enqueue and PDF readiness commit atomically and remain idempotent.
- Customer access authorizes before presigning; object references stay out of API JSON.
- PostgreSQL bytea remains the default; R2 writes and reads activate only with `PLIEGO_R2_ENABLED=true`.
- New database and R2 objects share the same artifact lease, checksum and READY invariant.

### Negative

- Full Roboto embedding increases PDF size in exchange for deterministic output and broad Latin coverage.
- Historical READY files are not regenerated into the new layout and receive no email.
- Disabling R2 does not migrate R2 objects back into PostgreSQL; keep its configuration available until an optional backfill is implemented.

## Future R2 Backfill and Operations

- An optional future backfill may copy existing immutable bytea artifacts to private R2 keys. It must not update invoices or replace their bytes; use a separately reviewed process to record the new storage metadata and retain a verified database rollback copy until cutover is approved.
- Before enabling production R2, operators verify the provisioned private bucket, origin-specific CORS and lifecycle policy.
- Keep presigned GET TTL at or below 300 seconds and preserve authorization-before-presign.
- Keep R2 enabled while R2 references remain; disabling it does not backfill or delete those objects.

## Validation

PDFBox extraction tests cover values, tax groups, totals, cédula/RUC labels, disclaimers on every page, multipage pagination, unsupported Unicode replacement, determinism and prohibited SRI access-key/authorization/barcode text. PostgreSQL 18 gates cover database and R2 completion metadata, the READY storage invariant, READY-triggered email enqueueing, idempotency, owner-email selection, minimal payloads, no LEGACY/XML email and authorized access metadata. Unit tests cover AWS SigV4 PUT/GET vectors, worker ordering, config validation and storage selection. The live R2 smoke test runs only with `PLIEGO_R2_LIVE_TEST=true` and is not part of ordinary verification. API tests cover customer/admin routes, no-store headers and stable error codes. Frontend API types are regenerated from the updated OpenAPI contract.
