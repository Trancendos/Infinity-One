# Dependency and cost validation tracker

Doc ID: DOC-INF-DEP-001 · v1.0.0 · last reviewed 2026-10-25 · review monthly

The services themselves (One, Portal, Gate) use **no npm packages**: only Node's standard library.
So there is no `node_modules` supply chain to watch. Everything below runs as a container image.

| ID | Component | Version (pinned) | Licence | Cost | Used for | Backup alternative (also free) |
|---|---|---|---|---|---|---|
| DEP-INF-01 | Ory Hydra | `oryd/hydra:v2.3.0` | Apache-2.0 | $0 (self-hosted) | OIDC / OAuth2 server, tokens, JWKS | Keycloak (Apache-2.0), Authelia (Apache-2.0) |
| DEP-INF-02 | PostgreSQL | `postgres:16-alpine` | PostgreSQL Licence | $0 | Hydra's database | SQLite build of Hydra |
| DEP-INF-03 | Node.js | `node:22-alpine` | MIT | $0 | Runs One, Portal, Gate | Same code runs on Node 24 |
| DEP-INF-04 | cloudflared | `cloudflare/cloudflared:2025.10.0` | Apache-2.0 | $0 (Cloudflare Free plan) | Outbound tunnel, HTTPS | Tailscale Funnel (free personal tier), or Caddy with a port-forward |
| DEP-INF-05 | Docker Engine + Compose | latest from get.docker.com | Apache-2.0 | $0 | Runs the containers | Podman (Apache-2.0) |
| DEP-INF-06 | Oracle Cloud Always Free VM | A1.Flex, Ubuntu 24.04 | n/a | $0 within Always Free limits | Host | Any PC or Raspberry Pi with Docker; Google Cloud e2-micro free tier |

## Known risks

- **Oracle idle reclamation**: Always Free instances that stay nearly idle for 7 days can be reclaimed.
  Mitigation: nightly backups (`deploy/scripts/backup.sh`) and a 1-hour rebuild path, or upgrade to
  Pay As You Go (Always Free stays free).
- **Hydra licence**: Apache-2.0 for the open-source edition we use. Ory's paid "Enterprise" builds are
  not used and not needed.
- **No Cloudflare Workers** are added by this design. The tunnel is not a Worker.

## How to check for updates (no CI needed)

On the VM, once a month:

```bash
docker run --rm oryd/hydra:v2.3.0 version
# compare with https://github.com/ory/hydra/releases and https://github.com/cloudflare/cloudflared/releases
```

Read the release notes for security fixes, change the tag in `deploy/docker-compose.yml`, run
`docker compose pull && docker compose up -d`, and add a row to [../logs/ACTIVITY-LOG.md](../logs/ACTIVITY-LOG.md).
