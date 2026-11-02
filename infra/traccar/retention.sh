#!/usr/bin/env bash
# Deletes Traccar positions and events older than RETENTION_DAYS (default 30).
# RIO keeps its own location history in the rio database, so Traccar's copy is
# only a short buffer. Runs nightly from rio-gps-traccar-retention.timer.
#
# Safe by design:
# - Each device's latest position (tc_devices.positionid) is never deleted.
# - Deletes in batches of 20,000 rows per device with a commit after each, using
#   the (deviceid, fixtime) index, so locks are short and Traccar keeps writing.
# - Read-only on every other table.
set -euo pipefail
DAYS=${RETENTION_DAYS:-30}
if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || ((DAYS < 7)); then
  echo "RETENTION_DAYS must be a number >= 7" >&2
  exit 1
fi
# TRACCAR_PSQL overrides the client (tests only).
read -r -a PSQL <<<"${TRACCAR_PSQL:-docker exec -i rio-gps-postgres-1 psql -U postgres -d traccar}"
PSQL+=(-v ON_ERROR_STOP=1 -qAt)

log() { printf '{"event":"%s","days":%s%s}\n' "$1" "$DAYS" "${2:-}"; }
before=$("${PSQL[@]}" -c "select count(*) from tc_positions")
log traccar_retention.start ",\"positions\":$before"

"${PSQL[@]}" <<SQL
DO \$\$
DECLARE
  d record;
  n int;
  cutoff timestamp := now() - interval '$DAYS days';
BEGIN
  FOR d IN SELECT id, coalesce(positionid, 0) AS keep FROM tc_devices LOOP
    LOOP
      DELETE FROM tc_positions WHERE id IN (
        SELECT id FROM tc_positions
        WHERE deviceid = d.id AND fixtime < cutoff AND id <> d.keep
        LIMIT 20000);
      GET DIAGNOSTICS n = ROW_COUNT;
      COMMIT;
      EXIT WHEN n = 0;
    END LOOP;
    LOOP
      DELETE FROM tc_events WHERE id IN (
        SELECT id FROM tc_events WHERE deviceid = d.id AND eventtime < cutoff LIMIT 20000);
      GET DIAGNOSTICS n = ROW_COUNT;
      COMMIT;
      EXIT WHEN n = 0;
    END LOOP;
  END LOOP;
END
\$\$;
SQL
"${PSQL[@]}" -c "vacuum (analyze) tc_positions" -c "vacuum (analyze) tc_events"
after=$("${PSQL[@]}" -c "select count(*) from tc_positions")
log traccar_retention.done ",\"positions\":$after,\"deleted\":$((before - after))"
