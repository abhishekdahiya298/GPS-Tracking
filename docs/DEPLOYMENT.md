# RIO GPS Tracking — VPS Deployment

This document covers deploying the v0 stack to a Linux VPS so a real FMM230
can reach Traccar over the public internet. It does **not** cover choosing a
VPS provider, DNS registrar, or actually running these steps yet — see
PHASE 9/10 in the accompanying task report for what's still pending approval.

## 1. Required VPS specification

Minimum for v0 (single vehicle, low device count):

- 2 vCPU, 4 GB RAM, 40 GB SSD
- Public IPv4 address (static)
- Outbound + inbound internet access, no CGNAT (the FMM230 must reach this
  machine directly on a TCP port)

## 2. Ubuntu/Linux requirement

- Ubuntu 22.04 LTS or 24.04 LTS (x86_64)
- No Windows-specific tooling anywhere in this stack — `infra/docker-compose.yml`,
  the Dockerfiles, and `infra/postgres/init-databases.sh` all run unmodified
  on Linux. The one Windows-specific detail from local dev
  (`POSTGRES_HOST_PORT=55432`, worked around a pre-existing native Postgres
  install) does not apply on a fresh VPS — leave it at the default `5432`.

## 3. Required ports

| Port | Service | Exposure |
|---|---|---|
| 22 | SSH | Restricted to your admin IP(s) if possible |
| 80 | Caddy (HTTP → HTTPS redirect + ACME challenge) | Public |
| 443 | Caddy (HTTPS, RIO web) | Public |
| 5027 | Traccar Teltonika listener | **Public** — the FMM230 connects here directly |
| 5432 | Postgres | **Not exposed** — loopback-only in compose, also blocked at the firewall |
| 6379 | Redis | **Not exposed** — loopback-only in compose, also blocked at the firewall |
| 8082 | Traccar admin UI/REST API | **Not exposed** — loopback-only in compose; reach it via SSH tunnel (`ssh -L 8082:localhost:8082 user@vps`) |
| — | RIO worker | No port at all, not reachable from outside the compose network |

## 4. Firewall rules

Using `ufw` as an example (adjust for your provider's own firewall/security
groups if you have one — prefer configuring it at the cloud-provider level
in addition to the host firewall):

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 5027/tcp
ufw enable
```

Do **not** open 5432, 6379, or 8082 — they're bound to `127.0.0.1` in
`infra/docker-compose.yml` already (defense in depth: even a firewall
misconfiguration wouldn't expose them, since nothing is listening on the
public interface for those ports).

## 5. Docker installation

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out/in for the group change to apply
docker compose version   # confirm the compose plugin is present
```

## 6. DNS requirements

- One A record: `your-domain.example` → VPS public IP.
- Point it **before** starting the stack — Caddy requests a Let's Encrypt
  certificate on first boot and needs DNS to already resolve.
- Do not put the domain behind Cloudflare's proxy (orange cloud) for the
  Traccar device port — that's a raw TCP port, not HTTP, and Cloudflare's
  standard proxy doesn't forward it. The RIO web domain (port 443) can be
  Cloudflare-proxied if desired; the FMM230 connects to the **VPS's public
  IP or a non-proxied DNS record** on port 5027, not through Cloudflare.

## 7. Environment variables

Copy `.env.production.example` to `.env` on the VPS:

```bash
cp .env.production.example .env
chmod 600 .env
```

Fill in every `change_me` with a freshly generated value
(`openssl rand -hex 16` for passwords, `openssl rand -base64 32` for
secrets) — never reuse a development secret. Set `RIO_DOMAIN` to the real
domain and `AUTH_URL` to `https://<that domain>`. Never commit this file —
it's gitignored, and secret values should never be printed to logs, commits,
or chat.

## 8. Database initialization

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis
docker compose -f infra/docker-compose.yml ps   # wait for postgres: healthy
pnpm db:generate   # only if the schema changed since the last migration
pnpm db:migrate    # run from a machine/container with RIO_DATABASE_URL set
```

`infra/postgres/init-databases.sh` runs automatically on the postgres
container's first boot — it creates the `rio` and `traccar` databases and
roles from `RIO_DB_PASSWORD`/`TRACCAR_DB_PASSWORD` in `.env`. Verify both
exist and stay separate:

```bash
docker exec rio-gps-postgres-1 psql -U postgres -c "\l"
docker exec rio-gps-postgres-1 psql -U postgres -d rio -c "\dt"
docker exec rio-gps-postgres-1 psql -U postgres -d traccar -c "\dt"
```

RIO's code must never open a connection to the `traccar` database, and
Traccar is never pointed at the `rio` database — this is enforced by using
separate roles/passwords, not just separate database names.

## 9. Traccar startup

```bash
docker compose -f infra/docker-compose.yml up -d traccar
docker compose -f infra/docker-compose.yml logs --tail=100 traccar
```

Confirm in the logs: no exceptions on startup, and the process stays up
(`docker compose ps` shows `Up`, not `Restarting`). This is the step that
failed under Windows Docker Desktop's Compose — verify carefully here, since
a Linux VPS is expected (but not yet confirmed) to not hit the same issue.

## 10. RIO startup

```bash
docker compose -f infra/docker-compose.yml up -d --build web worker reverse-proxy
docker compose -f infra/docker-compose.yml ps
```

The `worker` image currently fails to build (a pnpm/Alpine `tsc` resolution
issue under investigation — see the code report). This does not block
`web`, `traccar`, `postgres`, or `redis`; the worker does no real work yet
in v0 regardless.

## 11. Health checks

```bash
curl https://your-domain.example/api/health
# {"status":"ok","service":"rio-gps-web",...}

# Traccar admin (via SSH tunnel, not directly):
ssh -L 8082:localhost:8082 user@vps
# then open http://localhost:8082 in a local browser

# Teltonika port reachable from the public internet:
nc -vz your-vps-public-ip 5027   # run from OUTSIDE the VPS
```

## 12. Backup procedure

RIO's database only (never Traccar's — that's Traccar's own concern, back it
up separately if desired):

```bash
docker exec rio-gps-postgres-1 pg_dump -U rio -d rio -F c -f /tmp/rio-backup.dump
docker cp rio-gps-postgres-1:/tmp/rio-backup.dump ./rio-backup-$(date +%F).dump
```

Run this on a cron schedule once the VPS is live. An external backup
destination (S3, a managed backup provider, etc.) is intentionally **not**
configured yet — pick one after the VPS itself is chosen, per PHASE 7.

Restore:

```bash
docker cp ./rio-backup-2026-01-01.dump rio-gps-postgres-1:/tmp/restore.dump
docker exec rio-gps-postgres-1 pg_restore -U rio -d rio --clean /tmp/restore.dump
```

## 13. Log inspection

```bash
docker compose -f infra/docker-compose.yml logs --tail=100 web
docker compose -f infra/docker-compose.yml logs --tail=100 traccar
docker compose -f infra/docker-compose.yml logs --tail=100 postgres
docker compose -f infra/docker-compose.yml logs -f traccar   # follow live
```

## 14. Restart procedure

```bash
docker compose -f infra/docker-compose.yml restart web
docker compose -f infra/docker-compose.yml restart traccar
# Full stack, preserving volumes (never use `down -v`):
docker compose -f infra/docker-compose.yml down
docker compose -f infra/docker-compose.yml up -d
```

## 15. FMM230 connectivity requirements

Before connecting a physical device, confirm:

- Traccar is `Up` (not restarting) and its logs show a clean startup.
- `nc -vz <vps-public-ip> 5027` succeeds from a network outside the VPS
  (e.g. from your own laptop, not from inside the VPS itself).
- You have: the FMM230's real IMEI, the IoT SIM's APN from its provider, and
  the VPS's public IP or DNS hostname. None of these are guessed or
  fabricated anywhere in this codebase.
- The device is registered in Traccar (by IMEI, Teltonika protocol) only
  after the above is verified — never register a placeholder/fake device
  as a substitute for real verification.
