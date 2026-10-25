#!/usr/bin/env sh
# Nightly backup of Hydra's database and the One directory. Keeps 14 days.
# Add to the VM's crontab:  15 3 * * * sh /opt/infinity-one/deploy/scripts/backup.sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T postgres pg_dump -U hydra hydra | gzip > "backups/hydra-$STAMP.sql.gz"
docker compose exec -T one sh -c 'tar -C /data -cz .' > "backups/one-$STAMP.tar.gz"
find backups -type f -mtime +14 -print -exec rm -f {} \;
echo "backup $STAMP done"
