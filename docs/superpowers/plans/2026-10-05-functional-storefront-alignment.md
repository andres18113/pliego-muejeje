# Functional storefront alignment

Authority: the user's five architecture corrections before Claude's visual pass. No UI redesign, commits, pushes or deployment.

1. Navigation agent: connect SiteHeader and HomeNextReading to useStorefrontNavigation; derive preview criteria from server hrefs, remove competing destinations, expose Help, preserve current presentation and test loading/error/selected-media paths.
2. Checkout agent: add V049 public Database API line capabilities, map through cart/customer-order contracts, require aggregate counts, remove presentation format inference for fulfillment/quantity decisions and preserve command receipts/recovery. Own related backend/frontend focused regressions.
3. Library/contracts agent: map source-purchase labels in a reusable view model using existing Spanish purchase labels; preserve machine states. Prove BEST_SELLING frontend finite union matches authoritative OpenAPI pattern without unrelated generation changes.
4. Integrator: inspect contract diffs, export only relevant schema changes and regenerate deterministically when needed, update ADR/handoff, run focused PostgreSQL/HTTP/backend/frontend/browser checks and independent review. Logs: /tmp/pliego-architecture-alignment.

## Integration ownership
Navigation owns storefront hooks/view adapter/header/home/tests. Checkout owns purchase capabilities and its fixtures. Library owns library view models/route labels/catalog contract tests. Integrator alone owns OpenAPI/generated snapshots, shared migration expectations, documentation and final verification.

## Rulings
- Backend aggregate cart capabilities already decide checkout mode; new line capabilities close the remaining delivery-list/quantity-control inference without moving business rules into React.
- Generated sort is string because OpenAPI validates it with a pattern. Keep the deliberately narrower frontend union and verify it against that pattern; do not rewrite unrelated generated contracts.
- ISO dates/durations, tabs/chips, visual mega-menu and final library/Help presentation remain Claude's work.

## Completion evidence
- Navigation/header/home consume one projection; loading/error/retry and filtered Offers previews are covered. Hardcoded destinations removed.
- V049 and cart/customer-order capability propagation passed fresh Flyway, five focused SQL gates and three live HTTP gates; HTTP also verifies the isolated CustomerOrderItem schema and actual digital/mixed capabilities.
- Library view models reuse Spanish purchase labels; BEST_SELLING serialization/pattern alignment tests pass with existing generated string semantics retained.
- Backend verify: 162 tests. Frontend: all 482 tests passed on installed Node 22 with --no-turbofan --no-maglev applied to parent/workers; native optimized workers crashed on Node 22/24 and full jitless is incompatible with Vite's Wasm parser. Typecheck/build passed with final scoped generated types.
- Browser coverage: 58 distinct focused scenarios verified across runs (42 non-header scenarios plus all 16 header scenarios after fixture corrections); pagination/detail-context regression passed independently. Catalog pagination now waits for authoritative reads to settle before existing result alignment.
- Independent review accepted: header recovery, server Offers filters and customer-only schema collision resolved. Only Cart, CartItem, CustomerOrderDetail and new CustomerOrderItem schemas changed; admin Item and server URLs remain unchanged. All 48 existing migrations unchanged. File manifest and complete logs: /tmp/pliego-architecture-alignment.
- No CSS redesign, dependencies, commits, pushes or deployment.
