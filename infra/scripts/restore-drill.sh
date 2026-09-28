#!/usr/bin/env bash
# Restore drill (plan/phases/phase-10 §10.2, O4): fetch the latest WAL-G base backup and WAL into
# a scratch Postgres, start it, verify every org's ledger and audit chain, report timings, and
# throw the scratch copy away. Run monthly (and after any backup change):
#
#   infra/scripts/restore-drill.sh /srv/aperture/.env
#
# Needs Docker and the same WAL-G settings as production (WALG_S3_PREFIX, AWS_*, WALG_LIBSODIUM_KEY).
set -euo pipefail

ENV_FILE="${1:-/srv/aperture/.env}"
NAME="aperture-restore-drill-$(date -u +%Y%m%d%H%M%S)"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
started=$(date +%s)

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker build -q -t aperture-postgres-walg -f "$DIR/docker/postgres.Dockerfile" "$DIR/docker" >/dev/null
docker volume create "$NAME" >/dev/null

echo "• fetching the latest base backup"
docker run --rm --env-file "$ENV_FILE" -v "$NAME:/var/lib/postgresql/data" --entrypoint /bin/sh aperture-postgres-walg -c '
  set -e
  wal-g backup-fetch /var/lib/postgresql/data LATEST
  touch /var/lib/postgresql/data/recovery.signal
  echo "restore_command = '\''wal-g wal-fetch %f %p'\''" >> /var/lib/postgresql/data/postgresql.auto.conf
  echo "archive_mode = off" >> /var/lib/postgresql/data/postgresql.auto.conf
  chown -R postgres:postgres /var/lib/postgresql/data
'
fetched=$(date +%s)

echo "• replaying WAL and starting"
docker run -d --name "$NAME" --env-file "$ENV_FILE" -v "$NAME:/var/lib/postgresql/data" -p 127.0.0.1::5432 aperture-postgres-walg >/dev/null
for _ in $(seq 1 120); do
  if docker exec "$NAME" pg_isready -q && [ "$(docker exec "$NAME" psql -U "${POSTGRES_USER:-aperture}" -tAc 'select pg_is_in_recovery()' 2>/dev/null || echo t)" = "f" ]; then break; fi
  sleep 2
done
ready=$(date +%s)
PORT=$(docker port "$NAME" 5432/tcp | head -1 | sed 's/.*://')

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
echo "• verifying ledger counters and audit chains"
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${PORT}/${POSTGRES_DB}" \
  pnpm --silent --filter @aperture/cli verify-db
done_at=$(date +%s)

echo "restore drill passed: fetch $((fetched - started))s, recovery $((ready - fetched))s, verify $((done_at - ready))s, total $((done_at - started))s"
