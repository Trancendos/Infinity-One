# Signing people in to a Location with Infinity-One

Doc ID: DOC-INF-INT-001 · v1.0.0 · 2026-10-25

Every Location uses standard OpenID Connect. Nothing Trancendos-specific is needed beyond reading
the `rights` claim.

| Setting | Value |
|---|---|
| Issuer / discovery | `https://auth.trancendos.com/.well-known/openid-configuration` |
| JWKS | `https://auth.trancendos.com/.well-known/jwks.json` (RS256) |
| Scopes | `openid email profile infinity` (+ `offline_access` for refresh tokens) |
| Flow | Authorization code with PKCE (S256). Required for public clients. |

## Claims

ID token (and `/userinfo`): `sub` (`INF-USR-...`), `email`, `name`, `rights`, `roles`, `platform_admin`.
Access token (JWT): the same `rights`, `roles`, `platform_admin` under `ext`.

```json
{ "sub": "INF-USR-…", "ext": { "rights": { "management-center": "admin", "townhall": "user" }, "platform_admin": true } }
```

A Location decides access by comparing the level for its own id with what it needs
(`viewer` < `user` < `admin`). Location ids are listed by `cli.js locations`
(`services/one/locations.json` seeds them).

## Management Center (desktop, Windows)

Registered as public client `management-center` (no secret). Use the RFC 8252 loopback pattern:

1. Start a listener on `http://127.0.0.1:<any free port>/callback`.
2. Open the system browser at the authorize endpoint with `client_id=management-center`,
   that `redirect_uri`, a `state`, and a PKCE `code_challenge`.
3. Exchange the code at the token endpoint with `code_verifier` (no client secret).
4. Allow the app only if `ext.rights["management-center"] == "admin"` in the access token.

Hydra accepts any port on the loopback address for this client; this was tested
(`deploy/test/mc-pkce.mjs`).

## Server-side web Locations (TownHall, Stage Gates, CMDB, CranBania)

Register a confidential client per Location (copy the `infinity-gate` block in
`deploy/scripts/register-clients.sh`), then either:

- do the code flow yourself (Gate's `services/gate/server.js` is a dependency-free example), or
- verify incoming `Authorization: Bearer <access token>` JWTs against the JWKS and read `ext.rights`.

Stage Gates (SVC-TWH-05) and the Tranc3 Infinity worker currently check HS256 tokens with a shared
secret. Moving them to JWKS verification is the follow-up that makes them accept Infinity-One tokens.

## Gate APIs for simple checks

With the Gate session cookie (same browser): `GET https://gate.trancendos.com/api/me` and
`GET /api/check?location=townhall&level=user` (200 allowed, 403 not, 401 not signed in).
