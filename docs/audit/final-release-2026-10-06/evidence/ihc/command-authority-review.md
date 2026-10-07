# Late command callbacks across actor changes

Read-only source review covered useBookCardActions, CartPage command/restore/reconciliation, and order cancellation. Root owns fixes. Four narrow temporary Vitest regressions used the actual SessionProvider, React hooks, QueryClient and generated API client with stubbed transport; no shared database was contacted. They fail on current source for the expected safety assertions.

1. Cart-add preflight GET starts as actor A. Actor B is established before the response resolves. The old operation continues to POST /cart/items with B's bearer and shows success in B's UI. useBookCardActions.ts mutationFn awaits getActiveCart before addEditionToCart without checking initiating authority.
2. Favorite PUT starts as A. B is established. A's late 401 clears B and navigates to sign-in. useFavoriteControl catch clears session and navigates without an initiating-authority guard.
3. CartPage DELETE starts as A. B is established and reads an empty B cart. A's late 401 changes current actor to guest. CartContent onError calls clearSession without checking the command actor.
4. Order cancellation starts as A. B is established; the stub denies B ownership of A's order with 404. A's late cancellation 401 still changes current actor to guest. Cancellation onError calls clearSession without checking the command actor.

Additional source-only boundaries use the same unsafe continuation pattern: save-for-later awaits favorite then removes a cart item; restore and reconciliation callbacks refetch and set local departed-title feedback/focus; favorite success updates selection/feedback and calls onChangedRef.current; uncertain favorite recovery reads and updates queries; cancellation success/error refetches, invalidates and displays feedback. These boundaries need a captured authority epoch plus component liveness, checked after every await and before subsequent commands or state/cache/navigation effects. A private subtree identity key or local-state reset is also needed to remove already-existing A feedback when B replaces A.

A command already issued to A may still commit on the server. Dropping obsolete client effects should not claim server cancellation. Safe current-actor recovery can read its own authoritative state separately.

Sanitized observed results are in command-authority-before.json. Bearer values are represented only as the actor label B; no credentials, passwords or raw traces were copied. Temporary tests/configuration remain in /tmp/pliego-final-audit/ihc-agent/command-authority.test.tsx and command-authority.config.ts.
