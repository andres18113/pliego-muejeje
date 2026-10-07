# StockStatus light: initial-run environment failure

The initial live-enabled run failed at the unavailable edition `/catalog/editions/43` (test line 91), with zero `main [data-stockstatus]` nodes. Its trace captured a React page error: `useSession debe usarse dentro de SessionProvider`, thrown from HeaderCart. The page crashed; this was not a failed stock-data assertion or contrast violation.

The browser stack used different Vite generations for session and HeaderAccount. The development-server log at 21:17:19 recorded a session.tsx HMR update, Fast Refresh invalidation because the useSession export was incompatible, and propagation to App/HeaderAccount and their consumers. The trace page error occurred immediately afterward. Root confirmed source edits during that run and classified the failure as HMR split-context contamination.

The fixture auth refresh returned HTTP 200. Its deliberate storefront navigation HTTP 404 also occurred on preceding successful pages and did not explain this crash.

After source edits were frozen, the light-only case passed once in 35.4 seconds with one worker, API fixtures, PLIEGO_E2E_BASE_URL=http://127.0.0.1:5174, and a unique output directory. See stock-light-isolated.log. That case exercises 320/390/768/1440/1920px across catalog, Home, favorites, available/unavailable edition detail, cart, and checkout. No production change was required for this diagnostic.

No raw trace was copied here because traces can contain session credentials. This summary and the isolated result log contain only synthetic fixture evidence.
