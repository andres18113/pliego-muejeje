# API amendment v1.0.7 — Simulated eBook and audiobook editions

Implemented by Flyway V032 and ADR-0016. This additive amendment supersedes the
physical-only format restrictions in the approved v1.0 baseline; the baseline
files and migrations V001–V031 are not rewritten. `/v3/api-docs` remains the
executable full contract. The frontend is deliberately not implemented here.

## Edition formats and metadata

Formats are `PAPERBACK`, `HARDCOVER`, `EBOOK`, `AUDIOBOOK`. They are edition
properties, never thematic categories. Multiple editions share an existing book.
ISBN remains optional and unique when supplied; SKU remains unique and immutable.

| Field | PAPERBACK / HARDCOVER | EBOOK | AUDIOBOOK |
|---|---|---|---|
| `pageCount` | Required, integer 1–100000 | Optional, integer 1–100000 | Must be null/omitted |
| `ebookFileFormat` | Null/omitted | Null/omitted or EPUB/PDF | Null/omitted |
| `audioDurationSeconds` | Null/omitted | Null/omitted | Required positive 32-bit integer |
| `narrators` | Omitted/null/empty | Omitted/null/empty | Required ordered array of 1–32 names |

Narrator names must be nonblank and at most 200 characters after trimming. The
Database API trims the names; their order is retained. Read responses always
return an array (empty for non-audio editions). Names are edition metadata and
are not assigned as authors. These typed fields describe simulated content;
there is no asset URL, upload, delivery or playback.

Metadata incompatibilities and changing a physical edition to digital (or vice
versa) use existing `P2048` / HTTP 400. Create a different edition of the same
book to change fulfillment family. Changes within a family are allowed when
all replacement metadata is coherent. Basic malformed field values use existing
`VALIDATION_ERROR` with Spanish messages. No new SQLSTATE mapping is introduced.

## Modified REST contracts

- `POST /api/v1/admin/editions` and `PUT /api/v1/admin/editions/{editionId}` accept
  the three new fields. PUT remains a full replacement, not a cover-only patch.
- `GET /api/v1/admin/editions` returns all three fields and accepts optional
  `format` with any of the four values, alongside existing filters. Physical
  `stockActual` is unchanged; digital `stockActual` is null, never fabricated zero.
- `GET /api/v1/catalog/editions` accepts all four format values in both legacy
  title/author/ISBN search and global `que` search. Each item includes the three
  metadata fields. Existing IDs and money retain their string representation.
- `GET /api/v1/catalog/editions/{editionId}` returns the same new fields and
  permits null `pageCount` for digital formats.
- `GET /api/v1/catalog/filter-options` includes new formats when present in
  public editions. The formats array remains database-backed, distinct and sorted.
- Category discovery includes active digital editions without requiring inventory.
- Favorite addition/listing supports stockless digital editions, with existing
  response fields and corrected availability.
- Cart reads add `format`. Existing `available` is quantity-aware. Digital lines
  require quantity exactly one on add/update; adding another unit fails `P4004`
  / HTTP 400. `unavailabilityReason` may also be `P4004` for an invalid stored
  digital quantity. Existing `P2043`, `P2042`, `P3002` meanings are unchanged.
- Checkout/order snapshots accept the new formats. Cancellation `restoredUnits`
  remains a JSON number, counting only restored physical units.

## Example creation requests

The IDs below are illustrative and must be resolved through existing ADMIN APIs.
Duration and narrator values below are explicit demonstration data, not a claim
about a real recording. Physical clients may continue omitting all new fields.

```json
{
  "bookId": "80",
  "publisherId": "7",
  "sku": "DEMO-EBOOK-001",
  "isbn13": null,
  "language": "es",
  "format": "EBOOK",
  "pageCount": null,
  "publicationDate": null,
  "price": "20.00",
  "coverUrl": null,
  "coverLicense": null,
  "coverSourceUrl": null,
  "coverAttribution": null,
  "ebookFileFormat": "EPUB",
  "audioDurationSeconds": null,
  "narrators": []
}
```

```json
{
  "bookId": "80",
  "publisherId": "7",
  "sku": "DEMO-AUDIOBOOK-001",
  "isbn13": null,
  "language": "es",
  "format": "AUDIOBOOK",
  "pageCount": null,
  "publicationDate": null,
  "price": "20.00",
  "coverUrl": null,
  "coverLicense": null,
  "coverSourceUrl": null,
  "coverAttribution": null,
  "ebookFileFormat": null,
  "audioDurationSeconds": 3600,
  "narrators": ["Narradora de prueba", "Narrador de prueba"]
}
```

## Availability, inventory and simulated purchasing

A public edition requires an ACTIVE book and ACTIVE edition. Existing physical
editions also retain the existing inventory-row requirement; out-of-stock
physical editions remain visible with `available=false`. Digital editions have
no inventory row and are available while book and edition are ACTIVE. ADMIN can
withdraw them using the existing edition status endpoint. No stock count or new
license pool is modeled.

Inventory listing omits digital editions. Inventory mutations and movement reads
for digital editions use `P3001` / HTTP 404. A database trigger also rejects direct
attempts to create or update physical inventory for a digital edition.

Checkout revalidates state/price under the existing master locks, checks stock
only for physical lines and creates SALE movements only for them. Rejected
payments preserve the cart and do not move stock. Mixed cancellation restores
only physical lines. Digital-only cancellation refunds without inventing stock.

The existing simulated order workflow still requires an address and retains its
logistics states. This amendment does not establish digital shipping, fulfillment
or entitlements. No EPUB/PDF upload, DRM, stream, player, reading/listening progress
or digital delivery is implemented.

## Database API and upgrade compatibility

`edicion` adds `ebook_formato VARCHAR(8)`, `audio_duracion_segundos INTEGER`,
`audio_narradores TEXT[] NOT NULL DEFAULT '{}'`. A shared typed validation function
is used by constraints and command routines. `numero_paginas` becomes nullable;
physical requirements are still enforced. Order format snapshots accept all four
formats and digital snapshot quantities must equal one.

Extended edition command overloads add `p_ebook_format VARCHAR`,
`p_audio_duration_seconds INTEGER`, `p_narrators TEXT[]` after the existing cover
inputs (before the create OUT identifier). Original command signatures delegate
to them with empty digital metadata. Catalog/detail/admin read results append
`ebook_file_format`, `audio_duration_seconds`, `narrators`; existing column order
is preserved. Admin search adds a final optional `p_format VARCHAR DEFAULT NULL`,
so existing six-argument SQL calls remain valid.

Existing physical rows receive empty narrator arrays and null digital fields;
prices, covers, page counts, inventory and order snapshots need no manual changes.
Formats cannot cross fulfillment families, protecting historical stock movements.

## Seeds and covers

The existing development importer accepts staging `formato: EBOOK/AUDIOBOOK`
and the three REST-named metadata fields inside `edicion`. It skips stock setup
for these formats and preserves digital metadata when synchronizing a cover URL.
Editions without ISBN resolve through registry `source_keys`; the cover preparer's
fallback identity includes digital metadata for digital formats only. Existing
physical fallback identities and ISBN assignments are unchanged. The seed checks
that all seeded editions are public without requiring other legitimate editions
to disappear.

Covers still belong to editions, use the existing permanent SKU registry, v2
hashed WebP object names and normalized manifest. Existing cover files, manifests,
registry assignments and exclusions are unchanged. Commercial seed price remains
USD 20.00 for development; only physical editions receive the five-unit minimum.

## Verification

`mvn -f backend/pom.xml verify`, the PostgreSQL 18 CI gate (now through V032),
`digital_editions_gate.sql`, `digital_editions_http_gate.py` and the three existing
cover pipeline test scripts verify this extension. The live gate tests all four
formats through actual JDBC/REST, not only fake gateways.
