#!/usr/bin/env sh
# Registers (or updates) the OAuth clients Infinity-One knows about. Safe to run again.
# Run on the VM from deploy/:  sh scripts/register-clients.sh
set -eu
cd "$(dirname "$0")/.."
. ./.env
ADMIN=${HYDRA_ADMIN:-http://127.0.0.1:4445}
H="-H Content-Type:application/json -H X-Forwarded-Proto:https"

upsert() { # $1 = client id, $2 = JSON body
  if curl -fsS $H "$ADMIN/admin/clients/$1" >/dev/null 2>&1; then
    curl -fsS -X PUT $H "$ADMIN/admin/clients/$1" -d "$2" >/dev/null && echo "updated $1"
  else
    curl -fsS -X POST $H "$ADMIN/admin/clients" -d "$2" >/dev/null && echo "created $1"
  fi
}

# Gate: confidential web client, first party (no consent screen).
upsert infinity-gate "{
  \"client_id\": \"infinity-gate\",
  \"client_name\": \"Infinity Gate\",
  \"client_secret\": \"$GATE_CLIENT_SECRET\",
  \"grant_types\": [\"authorization_code\", \"refresh_token\"],
  \"response_types\": [\"code\"],
  \"scope\": \"openid email profile infinity offline_access\",
  \"redirect_uris\": [\"$GATE_URL/callback\"],
  \"post_logout_redirect_uris\": [\"$GATE_URL/signed-out\"],
  \"token_endpoint_auth_method\": \"client_secret_basic\",
  \"metadata\": {\"first_party\": true, \"service_id\": \"SVC-INF-04\"}
}"

# Management Center desktop app: public native client, PKCE, loopback redirect (RFC 8252).
upsert management-center "{
  \"client_id\": \"management-center\",
  \"client_name\": \"Trancendos Management Center\",
  \"grant_types\": [\"authorization_code\", \"refresh_token\"],
  \"response_types\": [\"code\"],
  \"scope\": \"openid email profile infinity offline_access\",
  \"redirect_uris\": [\"http://127.0.0.1/callback\", \"http://localhost/callback\"],
  \"token_endpoint_auth_method\": \"none\",
  \"metadata\": {\"first_party\": true, \"required_right\": \"management-center:admin\"}
}"
