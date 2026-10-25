# Moving auth.trancendos.com to Infinity-One

Doc ID: DOC-INF-DNS-001 · v1.0.0 · 2026-10-25 · Status: **PLANNED, NOT DONE**

Nothing in this document has been changed in Cloudflare. It is done only after the VM answers
(Part 5 of [SETUP-VM-AND-TUNNEL.md](SETUP-VM-AND-TUNNEL.md)) and Drew confirms each step.

## What exists today (read-only audit, 2026-10-25)

- `auth.trancendos.com` is a proxied CNAME to the Cloudflare Worker **infinity-auth-api**
  (password login API at `/api/v1/auth/*`, HS256 tokens, D1 database `infinity-identity`, KV `SESSIONS`).
  It has no OpenID Connect endpoints, so the Management Center cannot use it.
- `trancendos.com`, `app.`, `demo.`, `infinity-os.` serve the Pages project **infinity-portal**.
- Tunnel **TranceLinkHub** exists and has never connected.

## Planned changes, in order

| # | Change | Undo |
|---|---|---|
| 1 | Add a custom domain `auth-legacy.trancendos.com` to the **infinity-auth-api** worker (Workers > infinity-auth-api > Settings > Domains & Routes > Add > Custom domain). The worker, its D1 and KV stay untouched. | Remove that custom domain. |
| 2 | Check `https://auth-legacy.trancendos.com/api/v1/auth/me` answers like the old address did. | n/a |
| 3 | Remove the `auth.trancendos.com` custom domain/route from **infinity-auth-api** (only the hostname binding, never the worker). | Add it back. |
| 4 | In tunnel TranceLinkHub add public hostname `auth` . trancendos.com → HTTP `hydra:4444`. | Delete that hostname, then do step 3's undo. |
| 5 | Open `https://gate.trancendos.com` and sign in end to end. | Steps 4 then 3 undo. |
| 6 | Anything still calling `auth.trancendos.com/api/v1/...` (infinity-portal Pages app, other workers) is pointed at `auth-legacy.trancendos.com` until it moves to OIDC. | Point back. |

Steps 1 to 4 take a few minutes. Expected downtime of the old login API at `auth.` is the gap
between steps 3 and 4 (under a minute), and old callers keep working on `auth-legacy.` from step 1.

## Not changed by this plan

- The apex `trancendos.com` and the Pages project stay as they are. Pointing the main site's
  "Sign in" button at Gate is a later, separate change.
- No Worker is deleted. The old worker's code is also exported to `archive/legacy-worker/`
  in this repo before step 3, for human review.
- Existing users in the old D1 database are not migrated automatically: its password-hash
  format has not been reviewed. Until it is, people are re-created with the One CLI.
