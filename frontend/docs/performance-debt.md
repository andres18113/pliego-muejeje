# Frontend performance debt

## Main catalog entry chunk

Measured with `npm run build` on 2026-09-25 using Vite 8.3.1:

- Initial JavaScript entry: `519.84 kB` minified (`519,845` bytes), above Vite's `500 kB` warning threshold.
- Gzip estimate reported by Vite: `161.61 kB`.
- Edition detail route chunk: `13.50 kB` minified / `4.44 kB` gzip.
- Authentication route chunk: `13.01 kB` minified / `3.97 kB` gzip.

The size warning is accepted as performance debt for this release. The catalog is the initial public task; edition detail and authentication remain lazy-loaded. Revisit this debt if production field data shows a meaningful load or interaction delay, or if the compressed transfer grows materially.

## Production compression expectation

The frontend is built as static assets for a separately configured host. Vite's output is not precompressed. The local Vite preview returned the entry asset with `Content-Length: 519845` and no `Content-Encoding` when sent `Accept-Encoding: gzip, br`.

Production hosting is expected to negotiate gzip or Brotli for JavaScript and CSS. No production static-host configuration is present in this repository, so that host behavior could not be confirmed here. Verify the deployed asset response includes `Content-Encoding: gzip` or `Content-Encoding: br`; without compression, promote the chunk debt to a release fix.
