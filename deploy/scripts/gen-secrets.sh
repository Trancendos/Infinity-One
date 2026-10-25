#!/usr/bin/env sh
# Writes deploy/.env from .env.example with fresh random secrets (only if .env does not exist yet).
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] && { echo ".env already exists; not overwriting"; exit 1; }
rand() { openssl rand -base64 64 | tr -d '\n/+=' | cut -c1-48; }
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand)|" \
    -e "s|^HYDRA_SYSTEM_SECRET=.*|HYDRA_SYSTEM_SECRET=$(rand)|" \
    -e "s|^INTERNAL_TOKEN=.*|INTERNAL_TOKEN=$(rand)|" \
    -e "s|^GATE_CLIENT_SECRET=.*|GATE_CLIENT_SECRET=$(rand)|" \
    -e "s|^GATE_SESSION_SECRET=.*|GATE_SESSION_SECRET=$(rand)|" \
    .env.example > .env
chmod 600 .env
echo "Wrote deploy/.env with new secrets. Add CLOUDFLARE_TUNNEL_TOKEN next."
