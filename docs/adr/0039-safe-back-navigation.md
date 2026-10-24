# ADR-0039: Safe internal back navigation in PLIEGO shells

Date: 2026-10-17. Status: accepted with the approval of the implementation plan.

One shared policy serves the global header, the purchase header and error recovery. Its own history lives in memory, records React Router keys and resets when authority changes. It only accepts known internal destinations; it does not treat `history.length` or an arbitrary `from` as sufficient proof of safety. It groups filter changes of the same screen and falls back hierarchically when there is no verifiable previous visit.

Consumed authentication, token actions and a confirmed checkout are not reusable destinations. Navigation keeps the existing authority and view-lifetime defences: leaving a form does not cancel an operation already sent to PostgreSQL. Going back never repeats a purchase, cart, payment or invoice command. A lost response is reconciled through the existing attempt.

Contextual return mechanisms reuse the safe policy; shells avoid duplicate arrows. Focus and scroll follow the existing navigation policies. The global button only guarantees staying within PLIEGO for its own action: it cannot rewrite the browser's external history.

Required evidence: PUSH/REPLACE/POP, direct access, reload, external history, filters, authentication and user switch, uncertain/confirmed checkout, cart without duplicated commands, keyboard, and public/purchase/error shells.

## Addendum 2026-10-21: placement on the edition page

The edition page draws the arrow under the header, on the content edge, as product pages do. While it shows it, it claims the placement (`BackPlacementContext`) and the header leaves its slot empty; with a layer open, the header keeps its arrow to close it. On that page the header leaves with the scroll and does not compact. In the same frame the arrow's row leaves the viewport, the edition context bar appears fixed in place with the arrow — no slide, no fade — and it disappears the same way when the row returns. Exactly one arrow is ever in view and all of them use the same safe `goBack` policy. Other pages are unchanged.
