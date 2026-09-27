# Preparing cover assets

Add a category directory under `covers/`, place its staging JSON and referenced `.webp` files there, and list each cover filename in the record's `portadaArchivo` field. Keep the staging JSON in the same directory as its covers, or use a path relative to that JSON. The script discovers category directories and records recursively, so adding a category or more books does not require code changes.

From the repository root, run:

```bash
python3 scripts/prepare-covers.py
```

The script validates references and duplicate/conflicting data before writing outputs. It assigns permanent `PLG-BK-######` SKUs, using ISBN13 as the edition identity when available, and records assignments in `covers/sku-registry.json`. Keep that registry with the catalog so future runs preserve existing SKUs and only allocate new values.

Generated files are written under `covers/generated/`:

- `json/` contains normalized copies of each staging JSON with permanent SKUs.
- `r2/covers/editions/` contains WebP deployment copies named by permanent SKU.
- `manifest.json` maps ISBN, title, original cover, prior SKU, permanent SKU, R2 object key, and the corresponding public `cover_url`.
- The normalized JSON copies contain that same delivery URL at `edicion.portada.url`; unresolved license, source, and attribution values are preserved.

The script does not alter staging JSON or source WebP files and does not connect to Cloudflare or any remote service. The existing development seed reads the manifest and applies URLs to already-imported Editions with matching permanent SKUs; it does not invent missing catalog or commercial fields. Run the focused pipeline tests with:

```bash
python3 scripts/test_prepare_covers.py
```

## Uploading prepared assets to R2

Install the S3-compatible client and make `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, and `R2_BUCKET` available in the execution environment. Do not put credential values in this repository.

```bash
uv run --no-project --with-requirements scripts/requirements-r2.txt python3 scripts/upload-r2-covers.py
```

The uploader takes object keys and local files from `generated/manifest.json`, skips objects whose size, SHA-256 metadata, content type, and cache metadata already match, and verifies the R2 keys after syncing. It sets `Content-Type: image/webp` and a one-year immutable cache policy. It does not set object ACLs, enable public access, or configure a domain. Run its focused tests with `python3 scripts/test_upload_r2_covers.py`.
