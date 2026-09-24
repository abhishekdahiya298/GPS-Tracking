# Operations runbook

## Deploy (web only, zero-migration or additive-migration releases)

```bash
cd /opt/rio-gps
G='git -c safe.directory=/opt/rio-gps'
C='docker compose --env-file .env -f infra/docker-compose.yml'

# 1. Back up first
systemctl start rio-gps-backup.service
journalctl -u rio-gps-backup.service -n 20 -o cat | grep backup.done

# 2. Update the code
$G fetch origin && $G merge --ff-only origin/main

# 3. Keep a rollback image, then build
docker tag rio-gps-web:latest rio-gps-web:rollback
$C build web

# 4. Migrate with the new image before swapping (migrations are additive)
$C run --rm --no-deps -T web sh -c 'cd /repo/packages/db && pnpm -s migrate'

# 5. Swap only the web container
$C up -d --no-deps web
sleep 25
$C ps
curl -s https://gps.riocaliforniainc.com/api/health/ready
```

**Rollback** (the image only; additive migrations stay):

```bash
docker tag rio-gps-web:rollback rio-gps-web:latest
$C up -d --no-deps web
```

## Health and observability

| What | Where |
|---|---|
| Liveness | `GET /api/health` |
| Readiness (Postgres + Redis) | `GET /api/health/ready` |
| Ops snapshot (super admin) | `GET /api/admin/ops`: DB/Redis health, device online count, last history write, rows in the last 24 h, ingest counters since start, live stream count |
| Ingest counters | The web logs print an `ingest.stats` line every 5 minutes: `docker logs rio-gps-web-1 \| grep ingest.stats` |
| Errors | `docker logs --since 1h rio-gps-web-1 \| grep '"level":"error"'` |
| Backups | `systemctl list-timers rio-gps-backup.timer`; `journalctl -u rio-gps-backup.service` |

## Container hardening

- `web` runs as the unprivileged `node` user.
- `postgres` receives only the 3 variables its init script needs, not the whole `.env`. Editing unrelated `.env` values and recreating web or worker therefore no longer restarts the database.
- Only ports 22, 80, 443 and 5027 are public. Postgres, Redis and Traccar 8082 are on loopback or the internal network only.

## Admin CLIs (inside the web container)

| Command | Purpose |
|---|---|
| `pnpm admin:create-user` | Create a user (hidden password prompt) |
| `pnpm admin:backfill-history` | Import positions from the Traccar REST API (idempotent) |

Run them with `$C exec -it web …`. The `-it` flag is needed for the password prompt.
