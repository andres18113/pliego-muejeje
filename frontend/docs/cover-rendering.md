# Cover delivery and rendering

Catalog and detail covers share a 2:3 frame (300 × 450 equivalent). The existing `BookCover` loading, lazy-load, decode, fallback, and fit behavior is retained; CSS reserves the frame before image loading. The development importer now reads `covers/generated/manifest-normalized.json` by default and updates each matching Edition by permanent SKU through the existing ADMIN API.

The normalized manifest contains 55 content-addressed v2 URLs. Each published WebP is 600 × 900, and the existing REST field remains `coverUrl`. The catalog and detail page use the same versioned asset; there is no separate detail variant or on-the-fly Cloudflare transformation. License, source, and attribution fields are forwarded from the existing Edition unchanged.

SKU `PLG-BK-000042` (Apología de Sócrates) is intentionally absent from the normalized manifest. The development import flow marks its existing Edition `INACTIVE` through the established ADMIN status endpoint, so public catalog search and detail no longer return it. Its cover and provenance fields are left untouched in the Edition record. The source remains useful in component sizing tests, but is not part of the public cover data path.

## Source review

| Edition | Original source | Normalized result |
|---|---:|---|
| Apología de Sócrates | 371 × 784 | Excluded as SKU `PLG-BK-000042`; no v2 object. |
| Análisis matemático | 300 × 450 | Published as 600 × 900. |
| Análisis matemático I | 600 × 800 | Published as 600 × 900; the importer consumes the manifest URL. |
| Análisis matemático II | 270 × 353 | Published as 600 × 900; the importer consumes the manifest URL. |
| Anna Karénina | 777 × 1200 | Published as 600 × 900. |
| Cien años de soledad | 381 × 588 | Published as 600 × 900; the visible source side bands are removed in the v2 output. |
| La genealogía de la moral | 656 × 923 | Published as 600 × 900; its inset artwork and pale side area remain in the normalized output. |
| Los miserables | 729 × 1200 | Published as 600 × 900. |
| Moby Dick | 359 × 500 | Published as 600 × 900. |

The old greenish area seen around Apología came from the former sage frame behind its narrow source image. Apología is now excluded from public catalog results rather than mapped to a normalized URL.
