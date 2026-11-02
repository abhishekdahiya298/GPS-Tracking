# Operations runbook

## Deploy pipeline (GitHub Actions)

Normal deploys go through GitHub: **Actions > Deploy > Run workflow** (branch `main`).

| Action | What happens |
|---|---|
| `deploy` | All CI checks (type check, lint, unit, integration, build) run again; the web and worker images are built on GitHub (not on the server) and sent over SSH; the server then backs up the database, updates its config files to that commit, runs migrations, recreates **web and worker only**, and health-checks them. If they are not healthy within 150 s it switches back to the previous images by itself and the run fails. |
| `rollback` | Switches back to the version that was live before the last deploy (no rebuild, about 1 minute). |
| `status` | Shows the current and previous versions and container state. |

- Every pull request and push to `main` runs CI (`.github/workflows/ci.yml`).
- Postgres, Redis, Traccar and Caddy are never restarted by a deploy, so trackers stay connected. Traccar retries webhook deliveries for about 4 minutes (`forward.retry.*`), so positions sent while web restarts are not lost.
- The server keeps the last 5 deployed versions (`/var/lib/rio-deploy`).
- Migrations must stay additive (add columns/tables; drop or rename only in a later release). Then rolling the app back never needs a database rollback.
- The deploy key can only run `/usr/local/sbin/rio-deploy` (forced command, `restrict`): no shell, no forwarding.

**One-time setup** (and again after any change to `infra/deploy/rio-deploy`): on the server run `bash /opt/rio-gps/infra/deploy/install.sh`. On first run it creates the key; run `base64 -w0 /root/rio-deploy-key; echo` and paste that one line into the GitHub secret `DEPLOY_SSH_KEY` (one line survives copying from the web console; the raw multi-line key may not) (Settings > Secrets and variables > Actions), then `shred -u /root/rio-deploy-key`. Optional: Settings > Environments > production > Required reviewers adds an approval click before each deploy.

**Replacing the key:** `sed -i '/rio-deploy github-actions/d' /root/.ssh/authorized_keys && bash /opt/rio-gps/infra/deploy/install.sh`, then update the secret the same way. Each Deploy run first checks the key and the connection (about 10 s), so a bad key fails before tests and builds.

**On the server by hand:** `rio-deploy status`, `rio-deploy rollback`.

The manual steps below still work (for example if GitHub is down).

## Manual deploy (web only, zero-migration or additive-migration releases)

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

## Content-Security-Policy

Every HTML page gets a per-request, nonce-based CSP from `apps/web/src/middleware.ts`; the policy itself is built in `lib/csp.ts`:

- Only Next's own scripts can run: they carry the nonce, and `'strict-dynamic'` lets them load their chunks. There is no inline or third-party script.
- The map may fetch from `https://tiles.openfreemap.org` only, and runs its renderer in a `blob:` worker.
- `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` and `form-action 'self'` are set.

To allow another tile or asset host, add it in `lib/csp.ts`. If the map goes blank, look for "Refused to" CSP messages in the browser console.

## Admin CLIs (inside the web container)

| Command | Purpose |
|---|---|
| `pnpm admin:create-user` | Create a user (hidden password prompt) |
| `pnpm admin:backfill-history` | Import positions from the Traccar REST API (idempotent) |

Run them with `$C exec -it web …`. The `-it` flag is needed for the password prompt.
