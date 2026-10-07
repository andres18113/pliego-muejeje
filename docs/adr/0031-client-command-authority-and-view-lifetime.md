# ADR-0031: Bind asynchronous client commands to their issuing authority and view

Date: 2026-10-06. Status: Accepted for the final robustness audit.

## Evidence and decision

Held responses reproduced commands crossing account boundaries: a cart preflight could submit under the next account's bearer; old checkout data could populate its cache; late 401 responses could clear the new session; address/profile continuations could send or persist the wrong customer's data. Pending sign-in and password-reset continuations also replaced or cleared newer credentials.

`SessionProvider` owns an authority epoch. Explicit credentials, clearing and identity changes retire it; ordinary access-token rotation preserves it. `captureAuthority` supports both authenticated and Guest states. `useSessionOperationScope` combines that capture with the lifetime and resource of the issuing view. Resource transitions receive a fresh view marker; returning A→B→A cannot revive the original view capture. Private mutations capture their scope and command intent as mutation variables, rather than reading a subsequent render's options. Check the scope before each continuation that sends a command, publishes private data, clears authentication, moves focus or navigates.

`CustomerOnly` resets its private subtree at authority boundaries. Removing private queries and mutation records prevents cached results and pending UI state from crossing identities. Profile drafts additionally verify their customer before completing a save. Public catalog data remains reusable.

The API middleware compares the bearer actually sent with the current bearer when a private 401 arrives. A denied obsolete credential becomes `SessionRenewedError`, with safe Spanish recovery copy, and cannot expire renewed credentials. Genuine current-token and public authentication 401 responses retain their existing semantics. Uncertain writes retain read/reconciliation recovery; no automatic write replay is introduced.

Sign-in checks its original authority/view before establishing credentials and guards the existing brief success-announcement delay against the newly accepted authority and current view. Password-reset completion clears only the authority it captured at submission.

## Validation and boundaries

Regression tests retain actual requests/responses and completion signals for account changes, blocked command locks, cache publication, delayed 401s, profile drafts, route departures and same-user rotation. Authority tests also cover A→B→A and private mutation eviction. No server architecture, token lifetime, database business routine or approved visual design changes for this decision.
