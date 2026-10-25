# Testing Infinity-One locally

Doc ID: DOC-INF-TST-001 · v1.0.0 · 2026-10-25

Needs Docker and Node 22. Uses plain HTTP on localhost and Hydra's `--dev` flag, so it is for
testing only.

```bash
cd deploy
cat > .env <<'EOF'
POSTGRES_PASSWORD=testpgpasswordtestpgpassword
HYDRA_SYSTEM_SECRET=testsystemsecrettestsystemsecret1234
INTERNAL_TOKEN=testinternaltokentestinternaltoken12
GATE_CLIENT_SECRET=testgatesecrettestgatesecrettestgate
GATE_SESSION_SECRET=testsessionsecrettestsessionsecret12
ISSUER_URL=http://localhost:4444
PORTAL_URL=http://localhost:8042
GATE_URL=http://localhost:8046
HYDRA_DEV_FLAG=--dev
COOKIE_SECURE=false
EOF
docker compose up -d --build
sh scripts/register-clients.sh
docker compose exec -e ONE_PASSWORD='drew-test-password-1' one node cli.js create-user --email drew@example.com --name Drew --admin
node test/e2e.mjs http://localhost:8046 drew@example.com 'drew-test-password-1'
node test/mc-pkce.mjs http://localhost:4444 drew@example.com 'drew-test-password-1'
docker compose down
```

Unit tests for the directory: `node --test services/one/test/store.test.js`.

## Results on 2026-10-25 (TEST-INF-001)

- `store.test.js`: 5/5 pass (create/verify/claims, lockout after 5 misses, input validation,
  disabled accounts, CLI changes seen by the running server).
- `e2e.mjs` as an admin: Gate sends you to Portal, wrong password refused (401), missing CSRF
  refused (403), sign-in lands on Gate with all 8 Locations, `/api/check` for Management Center
  admin returns 200, sign-out clears the session.
- `e2e.mjs` as a viewer with only `townhall: viewer`: Gate shows only TownHall, Management Center
  check returns 403.
- `mc-pkce.mjs`: desktop public client with PKCE and a loopback redirect on an arbitrary port gets
  access, ID and refresh tokens; the access token is a JWT carrying `ext.rights`.
- Production mode (no `--dev`, issuer `https://auth.trancendos.com`): Hydra starts, serves
  discovery to the tunnel's network, and Portal reaches the admin API.

Not tested here: the real Cloudflare Tunnel and the real `trancendos.com` hostnames (this
environment cannot reach them). Those are checked in Part 5 of the setup guide.
