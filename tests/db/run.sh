#!/usr/bin/env bash
# Applies the migrations to a throwaway local Postgres and runs the role and status tests.
# Needs PostgreSQL 15+ installed locally (initdb, pg_ctl, psql). The storage migration is Supabase-only and skipped.
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
[ -n "${BIN:-}" ] || BIN=$(dirname "$(command -v initdb)")
DIR=$(mktemp -d); PORT=${PGTEST_PORT:-54329}
RUN=""; if [ "$(id -u)" = "0" ]; then chown -R postgres "$DIR"; RUN="runuser -u postgres --"; fi
cleanup() { $RUN "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
$RUN "$BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
$RUN "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start -w >/dev/null
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$DIR" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f tests/db/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  case "$f" in *storage*) continue;; esac
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f tests/db/rls_test.sql
