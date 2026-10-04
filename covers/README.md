# PLIEGO cover pipeline

Cover assets belong to editions. Physical, EBOOK and AUDIOBOOK editions share the
`covers/editions/v2/` CDN namespace and permanent `PLG-BK-######` SKU registry.
Each edition gets its own `{SKU}-{SHA256_FINAL_WEBP[:12]}.webp` object, even when
another edition has identical bytes. The manifest remains `pliego-cover-manifest-v1`.

## Local digital batches

From the repository root, after supplying the inventories and original images:

```bash
uv run --cache-dir /tmp/pliego-cover-uv-cache --no-project \
  --with-requirements scripts/requirements-covers.txt \
  python scripts/process-digital-covers.py --covers-dir covers \
  --inventory covers/Ebook/inventario.csv \
  --inventory covers/Audiolibros/inventario.csv
```

This command does not upload, call the API, regenerate physical covers, or alter
physical staging. It validates in a temporary catalog before committing local
staging, registry, informative JSON, immutable objects and the global manifest.
Existing normalized entries, including the 55 physical records, are preserved.
`PLG-BK-000042` remains excluded. A filesystem lock prevents simultaneous writers;
write failures roll back the registry, manifests and staging. An interruption may
leave an unreferenced immutable object; rerunning is safe and no old objects are deleted.

Expected layout:

```text
covers/
  sku-registry.json
  Ebook/
    inventario.csv
    Filosofia/
      originales/cover.jpg
      portadas/ebook-<16hex>.webp
      staging.json
  Audiolibros/
    inventario.csv
    Literatura/
      originales/cover.png
      portadas/audiobook-<16hex>.webp
      staging.json
  generated/
    json/Ebook/.../staging.json
    json/Audiolibros/.../staging.json
    r2-normalized/covers/editions/v2/<SKU>-<12hex>.webp
    manifest-normalized.json
    digital-batch/
      inputs/             # original JSON snapshots when explicit input is rewritten
      pending-images/
      reports/normalization-report.json
      reports/normalization-report.csv
```

Inventory CSV is UTF-8 (a BOM is accepted). Required headers:
`Categoria,Titulo,Autor,Archivo,Fuente`. `Archivo` is relative to the inventory's
directory, e.g. `Filosofia/originales/cover.jpg`. Absolute paths or paths escaping
the inventory directory are rejected. Format follows the inventory folder:
`Ebook` → EBOOK; `Audiolibros` → AUDIOBOOK. The thematic category comes from Categoria.

Optional enrichment headers are `editorial`, `idioma`, `isbn13`, `subtitulo`,
`sinopsis`, `paginas`, `anioPublicacion`, `fechaPublicacion`, `ebookFileFormat`,
`audioDurationSeconds`, `narrators`, `autores`, `coverLicense`, `coverSourceUrl`,
`coverAttribution`, `protectedRegions`, `editorialBorders`. Blank values become
null/empty arrays; missing facts are never invented. JSON-valued CSV fields must
contain valid JSON (and normal CSV quoting). `narrators` is an ordered JSON string
array; `autores`, if provided, is an array of `{nombre,orden}` objects. Otherwise
Autor is one complete author name; names are not split by guessing punctuation.

- Editorial and language are required before import; synopsis and ISBN may be null.
- EBOOK accepts EPUB/PDF or null, optional pages, no audio duration and no narrators.
- AUDIOBOOK requires positive integer duration in seconds and 1–32 narrator names;
  pages and ebookFileFormat must be null.
- Known evidence requires a V024-supported license and an HTTP(S) source URL;
  CC_BY/CC_BY_SA also require attribution. A platform name or URL alone never
  implies a license. Evidence is retained in staging and passed by the seed to ADMIN.
- Prices and stock are not image metadata; the local development seed retains its
  USD 20.00 policy and five-unit minimum only for physical editions. Digital stock
  is never seeded.

Staging filenames are deterministic: SHA-256 of
`FORMAT + "\n" + Fuente + "\n" + Archivo_POSIX`, first 16 hex characters, prefixed
with `ebook-` or `audiobook-`. Keep paths stable after SKU assignment. Identity and
source-key matching reuse the established registry algorithm; never reassign a SKU.
A different staging entry cannot replace an already published SKU silently.

Already-authored digital staging can be processed with repeated `--staging-file`:

```bash
uv run --cache-dir /tmp/pliego-cover-uv-cache --no-project \
  --with-requirements scripts/requirements-covers.txt \
  python scripts/process-digital-covers.py --covers-dir covers \
  --staging-file covers/Ebook/Filosofia/staging.json \
  --staging-file covers/Audiolibros/Literatura/staging.json
```

Each file contains a `libros` array with the established `libro`, `edicion` and
`portadaArchivo` fields. For raw input, portadaArchivo may reference a relative
JPG/PNG/WebP; the accepted output references `portadas/<name>.webp`. An optional
record-level `Archivo` identifies the original separately. Raw JSON is archived
before replacing it with accepted staging; pending records and their original
metadata remain available in reports/archives. Previously published valid metadata
is retained until its replacement passes. Do not use generated/json as seed input:
without ISBN, registry source keys refer to the original staging paths.

## Image safety contract

New processed outputs are 720 × 1080 (2:3), sRGB, opaque RGB WebP. Lanczos performs
one proportional resize from a fractional crop box; no stretching or padding.
Quality 86 → 84 → 82 → 80, method 6, stopping at the first result ≤204800 bytes.
Upscale factor is recorded; up to 4× is accepted, including ~220×320 sources.
Larger required amplification is FUENTE_INSUFICIENTE. No generated superresolution
or aggressive sharpening is used.

Order: EXIF/color → transparent exterior → confirmed uniform exterior → 2:3 crop
→ resize → WebP. Uniform bands use Lab ΔE76 ≤6 for ≥99% of pixels and a transition
ΔE76 ≥12 over ≥95% of useful edge length. Total trim is limited to 5% per side.
No confirmed transition means no trim. A large sloping jacket against a uniform
capture background is reviewed instead of perspective-warped. Ambiguous four-sided frames are reviewed,
not automatically stripped. Crop is limited to 10% total with center shifts of
at most ±5%. Unsafe crop/trim never falls back to a white contain canvas.

The detector protects conservative high-contrast glyph/logo-sized components.
It is not semantic OCR and cannot prove which uniformly colored area belongs to
an editorial design. Explicit hints supplement it:

- `protectedRegions`: JSON array of `[x0,y0,x1,y1]` boxes in EXIF-oriented source
  coordinates, before trim. Two source pixels guard protected content at cut edges.
- `editorialBorders`: JSON list of `left`, `top`, `right`, `bottom` sides known to
  belong to the cover design. Declare all four for an identified editorial frame.
  Crop cannot remove a declared side either; incompatible proportions stay pending.
- For JSON staging, put these hints in the optional `normalizacion` object.

Reports include original/oriented/clean dimensions, trim, crop and shift, scale,
final dimensions, quality, byte count, full SHA-256, SKU when known, status and reason.
States are ACEPTADO, METADATOS_PENDIENTES, REVISION_ENCUADRE,
FUENTE_INSUFICIENTE, PESO_EXCEDIDO and ARCHIVO_INVALIDO. Pending images go under
`generated/digital-batch/pending-images/`, never to an importable manifest.
Exit 0 means all inputs accepted; 2 means a completed batch with pending records;
1 means a structural/identity/filesystem failure. Fix facts or hints and rerun;
do not fabricate values merely to meet the expected lot count.

## Compatibility tools

`python3 scripts/prepare-covers.py` still prepares staged WebP and allocates stable
SKUs. Discovery admits `staging.json` and `pliego_*_limpio.json`, validates libros,
and ignores generated output/configuration including normalization-overrides.json.
Shared image bytes/references are informational; duplicate edition identities are
errors. It preserves legacy manifest.json/r2 copies for compatibility. Informative
generated JSON uses the published v2 URL when available.

`normalize-covers.py` uses the same new image engine. Existing immutable objects
are preserved and verified by default. `--renormalize-existing` is an explicit
opt-in to regenerate at new keys; it must not be used for a digital-only batch.
The old destructive `--clean` and white contain fallback are removed. Legacy
`mode: contain` overrides become REVISION_ENCUADRE, never padding.

The development seed discovers all recognized original staging by default; repeated
`--staging-file` permits a subset. Historical SKU 000042 is always excluded even
when the subset does not include its old row. It accepts null synopsis and ISBN,
resolves digital source keys, reuses existing thematic categories (including their
parentage), preserves digital metadata and imports complete cover evidence.

## Tests

```bash
uv run --cache-dir /tmp/pliego-cover-uv-cache --no-project \
  --with-requirements scripts/requirements-covers.txt \
  python -m unittest discover -s scripts -p 'test_*covers*.py'
python3 scripts/test_seed_cover_sync.py
```

Tests create synthetic images and temporary catalogs. The compatibility test
copies the existing physical catalog to a temporary directory, checks all 55
published records, registry assignments and file hashes, and normalizes only the
new synthetic digital input. It never changes repository cover assets.

## Future authorized publication

The existing uploader remains opt-in. Use explicit normalized arguments:

```bash
uv run --no-project --with-requirements scripts/requirements-r2.txt \
  python3 scripts/upload-r2-covers.py \
  --manifest covers/generated/manifest-normalized.json \
  --assets-dir covers/generated/r2-normalized
```

It sets image/webp, one-year immutable cache headers and sha256 metadata. It does
not configure public access or the domain. Do not delete historical CDN objects
merely to satisfy its strict unexpected-key listing check. No upload is part of
the preparation command.
