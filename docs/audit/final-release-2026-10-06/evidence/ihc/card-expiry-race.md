# Card expiry caret race: deterministic before/after

Source review identified uncancelled per-keystroke requestAnimationFrame callbacks that could reposition the expiry caret after newer input. The isolated harness intercepted only expiry selection RAF callbacks, leaving other browser animation callbacks running.

Before: typing 123 left 12 / 3 at caret 6. Replaying older callbacks moved the caret to 2. Typing 0 produced 12 / 03, and focus remained checkout-expiration. The expected correct date and CVV focus failed. The ordinary test could pass in a different schedule, so the controlled callback ordering established a product race rather than an artifact failure.

After root added per-field RAF cancellation, dialog/unmount cleanup, and current-value/active/connected guards, the identical independent harness passed once in 5.1 seconds. Older callbacks no longer moved the caret: position 6 stayed 6; the final value was 12 / 30; active element was checkout-cvv. Root's repository tests independently passed the rapid-input regression and normal valid/invalid progression.

Sanitized event evidence: card-expiry-race-before.json and card-expiry-race-after.json. This audit copied no raw trace, card number, CVV, password, or access token; APIs were synthetic fixtures and no shared database was touched. Only evidence files were written in the repository.
