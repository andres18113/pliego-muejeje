# ADR-0044: INEC geographic catalog for editable Ecuadorian addresses

## Status

Accepted

## Date

2026-10-25

## Decision drivers

- City selection must depend on an Ecuadorian province and be validated by PostgreSQL.
- Existing address readers, email templates, invoices and historical orders rely on text names.
- Ambiguous legacy data must remain intact and must not be guessed.
- Geographic reference data must be reproducible, versioned and read-only to application roles.
- Address commands continue through the existing Controller → Application Service → JDBC Gateway → PostgreSQL Database API boundary.

## Context and inventory

Editable inputs are saved customer addresses (`pliego.direccion`, V002), checkout billing addresses (including `OTHER`, V081), administrator supplied invoice addresses (`sp_invoice_issue`, V034/V041), and pickup-location master data (`pliego.ubicacion_retiro`, V040). They prefer catalog identifiers. V082 also keeps a time-boxed REST name-only adapter for older SPA bundles; PostgreSQL resolves those names to the same catalog identifiers before writing.

Order delivery addresses (`pliego.pedido_direccion`, V006), invoice billing addresses (`pliego.factura_direccion`, V034), and pickup history (`pliego.pedido_retiro`, V040) are immutable text snapshots. Transactional email projections/templates and invoice rendering read those names; they remain unchanged and no historical snapshot is rewritten.

The source-level inventory is:

| Classification | Repository location | Use and disposition |
|---|---|---|
| Editable customer address | `V002__create_identity_customer_tables.sql:32`; `V012__create_identity_customer_routines.sql:82,85,97`; `V082__ecuador_geographic_address_catalog.sql:1777,1798,1830`; `CustomerController.java:123,139`; `JdbcCustomerGateway.java:141,159` | Saved address schema, reads, creates and updates; now catalog-backed. |
| Editable checkout billing address, including `OTHER` | `CheckoutRequest.java:35`; `CheckoutController.java:48,63,88`; `JdbcCheckoutGateway.java:75`; `V081__checkout_billing_recipient.sql:19,94`; `V082__ecuador_geographic_address_catalog.sql:2003,2090` | One-time billing input; now uses or strictly resolves a province/city pair. |
| Editable administrator invoice address | `AdminOrderController.java:164,169,178`; `JdbcAdminOrderGateway.java:243,246`; `PostPurchaseRequests.java:27`; `V034__invoices_and_post_purchase_projections.sql:106`; `V082__ecuador_geographic_address_catalog.sql:1944,2123` | Invoice issue input; now uses or strictly resolves a province/city pair. |
| Editable pickup-location master | `V040__store_pickup.sql:6,81`; `PickupLocationController.java:16,18`; `V082__ecuador_geographic_address_catalog.sql:1899,1930` | Master location names stay text-readable and its editable source is now pair-validated. |
| Immutable order-delivery snapshot | `V006__create_order_payment_tables.sql:41`; `V019__create_triggers.sql:63`; `V040__store_pickup.sql:308` | `pedido_direccion` is append-only; checkout copies address text into it. |
| Immutable invoice billing snapshot | `V034__invoices_and_post_purchase_projections.sql:19,145`; `V082__ecuador_geographic_address_catalog.sql:1987` | `factura_direccion` stores canonical or historical text; old rows are not rewritten. |
| Immutable pickup history snapshot | `V040__store_pickup.sql:30,463` | `pedido_retiro` copies the location text at order creation. |
| Email and invoice/order read projections | `V039__transactional_email.sql:201`; `V043__home_delivery_lifecycle.sql:210`; `V061__transactional_order_lifecycle_emails.sql:45`; `V041__authoritative_monetary_projections.sql:447,476`; `V072__automatic_academic_billing.sql:585` | These read snapshot `ciudad`/`provincia` into email and API payloads; unchanged. |

## Official data source

The seed is derived from the latest retrievable official INEC classifier, the **Clasificador Geográfico Estadístico 2026**, updated through **2025-12-31**. The Excel workbook is the parsed source; the matching PDF is retained as a cross-check.

| File | Official URL | SHA-256 |
|---|---|---|
| `cge2026.xls` | <https://aplicaciones2.ecuadorencifras.gob.ec/SIN/descargas/cge2026.xls> | `6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e` |
| `cge2026.pdf` (cross-check) | <https://aplicaciones2.ecuadorencifras.gob.ec/SIN/descargas/cge2026.pdf> | `d77a2216ad976d84dfa1a9ce0d42abbaea47f9d11ef3897f40eea05b80f3dfe5` |

V082 seeds all 1,171 unique source codes: 223 canton-seat rows (one historical/inactive), 948 rural-parish rows, 1,048 active localities and 123 inactive historical rows; province code 90 (“Zonas no delimitadas”) is excluded. A full DPA 2025 code diff drove two parser rules that an earlier draft missed. First, the worksheet places several DPA code/name groups side by side on one row (rows 1022 and 3086 hold the La Concordia parishes 080851/080853 and 230251/230253; rows 1018 and 3082 are its seats 0808 and 2302), and row 3144 lists 140190 Sinaí-Cuchaentza on its own. Second, a seat row may omit the words `CABECERA CANTONAL`: row 2224 gives the heading `CANTÓN SEVILLA DON BOSCO` and row 2228 its seat (DPA 141350), so 1413 is a current seat while row 2096's starred 140157 stays inactive. The general star note is row 7. The draft's follow-up migrations were folded into V082 before any release, so the catalog never ships in an intermediate state.

## Considered options

1. Keep free-text city/province inputs and validate only in the frontend. Rejected because clients and database callers could persist mismatched locations.
2. Put province/city IDs on customer, order, invoice and pickup-history records. Rejected because historical snapshots must remain unchanged and their consumers expect immutable text.
3. Keep text on immutable snapshots while catalog IDs govern editable sources. Chosen because it centralizes validation and preserves existing readers and history.

## Decision outcome

Use `pliego.provincia` and `pliego.ciudad` with surrogate numeric IDs, official DPA codes, official accented display names, an active flag and `pliego.fn_search_fold`-derived search keys. A city stores its canton name because display names can repeat within or across provinces. Uniqueness is based on `(provincia_id, codigo_dpa)`, not names. City responses sort alphabetically with the existing Spanish ICU collation and canton name as a tie-breaker; the canton seat is not specially promoted. V082 adds `pliego.ciudad_alias` for source-backed names and backfills only null editable rows; it does not change snapshots. It also removes production-default DML grants from `pliego_app` on all three geographic reference tables and grants SELECT only.

Saved addresses and pickup-location master rows receive nullable `provincia_id` and `ciudad_id` columns for safe legacy backfill, a pair check, and a composite foreign key. New/updated addresses, pickup-location updates, checkout billing inputs and administrator invoice inputs require an active city/province pair. PostgreSQL copies the selected catalog names into the existing text columns. Catalog writes are limited to migrations; runtime application roles may read the catalog.

Backfill matches accent-folded, case-insensitive province names first, then active city names, canton-seat names and official aliases within that province. Only a unique match receives IDs; unmatched or ambiguous rows retain their original text and null IDs. Customer address reads expose `cityNeedsReview=true` while either ID is null. Editing such a row requires a new catalog choice. A name-only edit is accepted during the compatibility window only when the strict database resolver identifies exactly one active city.

Invoice, order-delivery and pickup-history snapshots remain text-only. Email and invoice-rendering projections continue to use their current text fields.

Public cacheable reads are `GET /api/v1/geo/provinces` and `GET /api/v1/geo/provinces/{provinceId}/cities`. IDs are JSON strings. Because the application has no existing ETag pattern for reference data, responses use `Cache-Control: public, max-age=86400, stale-while-revalidate=86400` without ETag.

Address, checkout and administrator invoice REST requests prefer `provinceId` and `cityId`. For older cached SPA bundles, the API temporarily accepts the complete `city`/`province` pair instead. The IDs pair and name pair are mutually exclusive. The name pair resolves by exact `fn_search_fold` match against an active canonical city, an official alias, or a canton seat's name. It then calls the ID-based routine; it never persists request text. The existing Database API text overloads remain strict adapters. Stable wire codes/SQLSTATEs are `P5014` (a known city is outside the supplied province) and `P5015` (unknown, inactive or ambiguous locality), with Spanish Problem Details.

## Evidence-backed aliases

The alias seed uses only the INEC CGE 2026 workbook cited above: 278 unique aliases scoped by province. They cover 231 urban-parish labels mapped to the canton seat, 6 current seat/parenthetical labels, 25 historical labels with an explicit active target, and 16 starred labels from the inactive-name audit below (the complete parenthetical labels are preserved as searchable aliases). Four spellings (Guanujo, El Cambio, Pascuales and Barreiro) enrich an urban-parish alias already present. Names already matching an active canonical city name are not duplicated. `fuente_evidencia` records the worksheet row(s), target DPA row and workbook SHA-256 for every alias.

The required results are Bucay → General Antonio Elizalde (Guayas) and Playas → General Villamil (Guayas). Other examples include Piedrahita/Nobol → Narcisa de Jesús, Chucchilán/Chugchilán → Chugchillán, Isinlibí → Isinlivi, Pedregal/Coronel Lorenzo de Garaicoa → Coronel Lorenzo de Garaycoa, `10 de Agosto` → Diez de Agosto, Tuutinentza → Tuutinentsa, Santa Rita → Babahoyo, and San Carlos del Zamora → San Carlos de Limón. Existing aliases are unique on `(provincia_id, fn_search_fold(nombre_alias))`; triggers reject self-name aliases, inactive targets and collisions with another active city or canton seat. Runtime roles have SELECT only.

Rejected alias candidates are recorded here so later seed changes do not reintroduce collisions:

- INEC parentheticals that say `CAB. EN ...`, `CABECERA CANTONAL` or `SATÉLITE` are location notes, not locality synonyms; their note text was not seeded as aliases.
- **Already resolves to an active canonical locality (36):** Las Naves, Azogues, El Ángel, Tulcán, La Maná, La Victoria, Machala, Santa Rosa (El Oro), Esmeraldas, Daule, Durán, Samborondón, Atuntaqui, Cariamanga, Catacocha, Catamayo, Macará, Quevedo, San Jacinto de Buena Fé, Valencia, Ventanas, Bahía de Caráquez, Chone, El Carmen, Manta, Montecristi, Portoviejo, Santa Ana, Gualaquiza, Sangolquí, Pelileo, Píllaro, Zamora, Nuevo Rocafuerte, Santo Domingo de los Colorados, Santa Elena (Santa Elena).
- **Ambiguous within the province (5):** González Suárez (Carchi); Eloy Alfaro (Guayas); Sagrario and San Francisco (Imbabura); San Sebastián (Loja). The historical `San Carlos` label in Guayas also conflicts with the active San Carlos locality in Naranjal; the historical `La Unión` label in Esmeraldas matches active localities in more than one canton.
- **Collides with another active locality (5):** El Paraíso (El Oro), La Unión (Los Ríos), Eloy Alfaro and San Pablo (Manabí), Rumipamba (Pichincha).
- **No supported active target or province-local mapping:** this category is updated by the full inactive-row audit below; La Concordia (2302) and Sevilla Don Bosco (1413) are canonical current seats, and neither is represented as an alias.

## Inactive-starred name audit

The audit starts with 27 inactive DPA rows whose folded labels had neither an active city name nor an alias in the same province. Sixteen evidence-backed alias labels map to one active locality; the two historical Isidro Ayora rows use one shared alias because both map to DPA 092850. Sevilla Don Bosco is its own canonical current seat, not an alias, because an alias equal to the canonical city name is prohibited.

| Alias added | Active locality | INEC CGE 2026 DPA 2025 evidence |
|---|---|---|
| `Chucchilán (Chugchilán)` | Chugchillán, 050751 | Historical 050452, row 537; current 050751, row 572. |
| `Isinlibí (Isinliví)` | Isinlivi, 050752 | Historical 050454, row 539; current 050752, row 573. |
| `Las Lajas` | La Victoria, 0714 | Historical 070253 with cabecera note, row 744; current canton/seat, rows 885/889. |
| `Coronel Lorenzo de Garaicoa (Pedregal)` | Coronel Lorenzo de Garaycoa, 092251 | Historical 092051, row 1244; current 092251, row 1262. |
| `Coronel Marcelino Maridueña (San Carlos)` | Coronel Marcelino Maridueña, 0923 | Historical 092052, row 1245; current canton/seat, rows 1264/1268. |
| `General Elizalde (Bucay)` | General Antonio Elizalde, 0927 | Historical 091052, row 1160; current canton/seat, rows 1041/1292. |
| `Isidro Ayora (Soledad)` | Isidro Ayora, 0928 | Historical 090651 and 092451, rows 1111/1278; current canton/seat, rows 1042/1298. |
| `Piedrahita (Nobol)` | Narcisa de Jesús, 0925 | Historical 090657, row 1113; current canton/seat, rows 1039/1284. |
| `Playas (Gral. Villamil)` | General Villamil, 0921 | Historical 090155, row 1063; current canton/seat, rows 1035/1252. |
| `Olmedo (Santa Bárbara)` | Olmedo, 1116 | Historical 110955, row 1546; current canton/seat, rows 1411/1621. |
| `Pindal (Federico Páez)` | Pindal, 1114 | Historical 110454, row 1477; current canton/seat, rows 1409/1600. |
| `Quilanga (La Paz)` | Quilanga, 1115 | Historical 110755, row 1510; current canton/seat, rows 1410/1611. |
| `Barreiro (Santa Rita)` | Babahoyo, 1201 | Historical 120151, row 1652; current urban Barreiro row 1647 and Babahoyo seat row 1643. |
| `San Carlos de Limón (San Carlos del Zamora)` | San Carlos de Limón, 140852 | Historical 140354, rows 2126–2127; current 140852, row 2185. |
| `Carlos Julio Arosemena Tola (Zatza-Yacu)` | Carlos Julio Arosemena Tola, 1509 | Historical 150152, row 2250; current canton/seat, rows 2238/2303. |
| `Chongón` | Guayaquil, 0901 | Historical 090151, row 1063, coded under canton 0901 Guayaquil. The row 7 note says a starred rural parish became urban, joined a new canton or was suppressed; it appears under no other canton or province, so it remains in Guayaquil, whose seat (row 1048) is the only active locality that contains it. |

The following nine inactive rows remain unaliased because a same-province active target is not supported:

| Inactive row(s) | Evidence and reason |
|---|---|
| Azuay 010455 `La Paz` | Starred row 88. The same folded name appears at active DPA 190451 in Zamora Chinchipe (row 2774), but the classifier provides no province-local link from Azuay and aliases cannot cross provinces. |
| Esmeraldas 0808 `La Concordia`; 080851 `Monterrey`; 080852 `La Villegas`; 080853 `Plan Piloto` | Starred rows 1018 and 1022–1023. Their current canonical names are in Santo Domingo de los Tsáchilas at 2302 and 230251–230253, rows 3082 and 3086–3087; no Esmeraldas target exists. |
| Napo 150351 `Ávila` | Starred row 2264; current active Ávila is 220451 in Orellana, row 3048. Cross-province, so no Napo alias. |
| Napo 150353 `Loreto` | Starred row 2266; current Loreto seat is 2204 in Orellana, row 3044. Cross-province, so no Napo alias. |
| Napo 150355 `Puerto Murialdo` | Starred row 2265; current active 220452 is in Orellana, row 3049. Cross-province, so no Napo alias. |
| Napo 150755 `San José del Payamino` | Starred row 2293; current active 220453 is in Orellana, row 3050. Cross-province, so no Napo alias. |

The remaining starred row, Morona Santiago 140157 `Sevilla Don Bosco` (row 2096), maps by the source's new-canton evidence to the restored canonical seat 1413 (canton heading row 2224, seat row 2228). It stays inactive; the current seat is selectable and name-searchable without a duplicate alias.

## REST compatibility window

Choose transitional REST acceptance (option b) to keep existing browser bundles working during the release rollout. A successful name-only request emits one privacy-safe `geo_legacy_payload operation=...` application log event; no city, province, customer or address values are logged. Remove the deprecated REST fields and adapter branches in a coordinated release after both conditions hold: 30 calendar days have elapsed from the API release, and the successful legacy event count has remained zero for seven consecutive days. If use continues at day 30, retain the adapter until the seven-day zero-use window is met. Direct PostgreSQL strict text overloads remain available for Database API callers.

The backfill matches only saved addresses and pickup-location master rows whose IDs remain null. Unmatched rows keep their text and expose `cityNeedsReview=true`. A HOME_DELIVERY checkout may still use such a saved address and snapshots its stored city/province text. An edit must resolve to an active catalog pair or fails with P5014/P5015. Order, invoice and pickup-history snapshots are never changed.

After applying V082 and before the application release, an operator can count rows requiring review with this read-only query. It is not to be run against production by this change:

```sql
SELECT 'customer_address' AS source, count(*) AS needs_review
  FROM pliego.direccion WHERE provincia_id IS NULL OR ciudad_id IS NULL
UNION ALL
SELECT 'pickup_location', count(*)
  FROM pliego.ubicacion_retiro WHERE provincia_id IS NULL OR ciudad_id IS NULL;
```

## Consequences

### Positive

- Province/city compatibility is enforced in the database for every writer.
- The frontend can load the catalog and submit stable string IDs.
- Existing orders, invoices, pickup history, notifications and rendered documents retain their historical names.
- Legacy ambiguity is surfaced for correction without data loss.

### Negative

- During the compatibility window, old API clients may send only a resolvable name pair; new clients should send catalog IDs.
- New INEC classifier versions require a new migration and reviewed seed changes.
- Some legacy addresses remain unlinked until customers select a city.

## Validation

The migration gates assert the V082 source totals (24 provinces, 1,171 cities, 223 seat rows, 948 rural-parish rows and 1,048 active localities), compare every unique workbook DPA code, assert the 278 aliases (including Bucay, Playas and Chongón), and enumerate the nine inactive rows left without an alias. They also verify the 1413 seat/140157 historical-row relationship, FK and alias collision guards, null-only legacy backfill, immutable snapshots and the V081-to-V082 upgrade. Java tests contain no catalog-total literals; `mvn clean verify` remains part of verification.
