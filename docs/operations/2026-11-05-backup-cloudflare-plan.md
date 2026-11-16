# Production backup Cloudflare packet — 2026-11-05

Prepared locally; **no Cloudflare/R2 API was called**. Claude executes the reviewed
REST packet; the owner alone enters secret values. The dedicated bucket is
`pliego-db-backups`, default jurisdiction, Standard storage. This packet cannot
address `billing-pliego`, covers, Workers, domains or application configuration.

| Prefix | Lock | Delete lifecycle |
| --- | --- | --- |
| `frequent/` | 7 days | 8 days |
| `daily/` | 30 days | 35 days |
| `weekly/` | 84 days | 91 days |
| `monthly/` | 365 days | 400 days |
| `object-backups/v1/` (invoice ciphertext/index/inventory/runs) | Indefinite | **None** |
| `canary/` | 1 day | 2 days |

Every finite lock is strictly shorter than its expiry. The invoice hold deliberately
has no age limit: an old content-addressed blob can remain referenced by newer DB
backups, and no fiscal period is approved. This is a proposed preservation hold,
not a legal-retention finding. Owner acceptance is recorded in the phase-B receipt.
Account administrators can remove/alter locks; keep configuration authority outside
the writer. No lock or lifecycle rule is applied to the live invoice source.
[Cloudflare bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
document prefix matching, overwrite/delete protection and administrator rule changes.
[Lifecycle behavior](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
is asynchronous: expiration is eligibility, not an exact deletion deadline. Canary
cleanup relies on lifecycle; do not manually delete canaries during this packet.

## Exact execution

1. Owner uses a temporary Cloudflare API token with `Workers R2 Storage Write`
   on the chosen account and a short TTL (one day maximum). This control-plane
   token is separate from the three operational S3 credentials. The
   [Create Bucket API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)
   documents that permission. Owner runs in an unrecorded own terminal:

   ```bash
   mkdir -m 700 /private/pliego-cloudflare-admin
   deploy/backup/ops/cloudflare-auth.sh /private/pliego-cloudflare-admin/auth.curl
   ```

   Use an actual private path outside all repositories/evidence. No shell tracing,
   terminal recording or secret environment variable; the script prompts silently
   and writes directly to its final 0600 file. Claude sees only the file path.
2. Claude fills only non-secret `account_id` and reviews the generated plan:

   ```bash
   account_id=REPLACE_WITH_32_LOWERCASE_HEX
   python3 deploy/backup/ops/cloudflare-bucket.py plan --account-id "$account_id" \
     > .release-evidence/2026-11-05-prod-backup/prod/cloudflare-plan.json
   python3 deploy/backup/ops/cloudflare-bucket.py apply --account-id "$account_id" \
     --auth-config /private/pliego-cloudflare-admin/auth.curl \
     --report .release-evidence/2026-11-05-prod-backup/prod/cloudflare-apply.json
   python3 deploy/backup/ops/cloudflare-bucket.py readback --account-id "$account_id" \
     --auth-config /private/pliego-cloudflare-admin/auth.curl \
     --report .release-evidence/2026-11-05-prod-backup/prod/cloudflare-readback.json
   ```

   `plan` has no network path. `apply` checks bucket presence before POST; creates
   only when absent; checks existing Standard/default jurisdiction and custom domains;
   rejects unexpected lock/expiry rules; then applies the exact desired configuration.
   It preserves only the documented default seven-day abort-incomplete-multipart rule
   if present (no completed-object expiry). Repeating exact configuration is safe.
   A partial run can be reapplied. Existing unexpected rules/custom domains cause a
   stop before configuration mutation; review rather than erasing prior protections.
3. Require exit 0 and `result=PASS` for apply and independent readback. The latter
   exports non-secret configuration and checks exact required prefix sets, including
   invoice lifecycle exclusion, public `r2.dev` disabled, **zero custom domains** and
   zero CORS rules. A successful GET containing `{}` is accepted as absent CORS
   because its `rules` field is optional; unknown/null/404 response is a stop, not
   proof of privacy. CORS DELETE is sent only when rules exist, avoiding reliance
   on undocumented absent-policy DELETE behavior. Do not activate backups on FAIL.
4. Owner deletes the local temporary auth file and revokes the temporary token.
   Keep only the secret-free JSON exports. Never transfer this admin credential to
   the VPS. Operational tokens cannot change these bucket settings.

## REST contract used by the script

All paths are below `https://api.cloudflare.com/client/v4/accounts/{account_id}`;
JSON bodies are produced by `desired()` and the offline plan above. Authorization
is a private curl configuration file, never an argv header. No CLI dependency or
unpinned `npx` is needed.

| Operation | Method / path | Exact body or check |
| --- | --- | --- |
| Existence/read bucket | `GET /r2/buckets/pliego-db-backups` | name, `storage_class=Standard`, jurisdiction default |
| Create only if absent | `POST /r2/buckets` | `{"name":"pliego-db-backups","storageClass":"Standard"}` |
| Disable managed public access | `PUT /r2/buckets/pliego-db-backups/domains/managed` | `{"enabled":false}` |
| Verify managed/custom access | `GET .../domains/managed`, `GET .../domains/custom` | disabled, `domains=[]` |
| CORS | `GET .../cors`, conditional `DELETE .../cors` | absent/empty rules |
| Lock replacement / readback | `PUT .../lock`, `GET .../lock` | rules use `condition.maxAgeSeconds`, `type=Age` or `Indefinite` |
| Lifecycle replacement / readback | `PUT .../lifecycle`, `GET .../lifecycle` | `conditions.prefix`, `deleteObjectsTransition.condition={"type":"Age","maxAge":seconds}` |

The official references distinguish create `storageClass` from response
`storage_class`, and lock `maxAgeSeconds` from lifecycle `maxAge`:
[locks](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/locks/methods/update/),
[lifecycle](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/methods/update/).
Public-access verification follows the
[managed-domain API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/managed/methods/update/)
and [custom-domain list API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/custom/methods/list/).
CORS follows [GET](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/cors/methods/get/)
and [DELETE](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/cors/methods/delete/).
These public documentation pages were checked 2026-11-05; real API behavior,
permissions, lock enforcement and lifecycle timing remain phase-B/D gates.
