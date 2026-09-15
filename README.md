# RIO GPS Tracking

Standalone GPS fleet-tracking SaaS. Independent from the existing RIO TMS —
no shared code, database, or deployment.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the v0 data flow and
design decisions, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for deploying
to a Linux VPS.

## Stack

Next.js · React · TypeScript · pnpm workspaces · PostgreSQL · Drizzle ORM ·
Redis · Traccar · Zod · Docker Compose · Caddy

## Repository layout

```
apps/
  web/      Next.js dashboard + API routes (webhook ingest, SSE stream)
  worker/   background process scaffold (no queues yet in v0)
packages/
  db/               Drizzle schema, migrations, client
  core/             domain types + Zod schemas, provider-agnostic
  traccar-client/   Traccar REST + webhook wrapper — the only place Traccar's
                     data model is allowed to appear
  config/           shared tsconfig/eslint base
infra/
  docker-compose.yml
  docker/           Dockerfiles for web/worker
  postgres/         init script (creates separate rio + traccar databases)
  traccar/          traccar.xml (Teltonika port, webhook forwarding)
  Caddyfile         production reverse proxy (web app only)
```

## Local development

```bash
corepack enable
pnpm install
cp .env.example .env   # fill in secrets before running anything real
# If port 5432/6379 is already taken on your machine (e.g. a native Postgres
# install), set POSTGRES_HOST_PORT/REDIS_HOST_PORT in .env to something free
# and update RIO_DATABASE_URL/TRACCAR_DATABASE_URL's port to match.

# infra (Postgres, Redis, Traccar)
docker compose -f infra/docker-compose.yml up -d postgres redis traccar

# database schema
pnpm db:generate   # generate SQL migrations from packages/db/src/schema
pnpm db:migrate    # apply them to RIO_DATABASE_URL

# app
pnpm dev:web       # http://localhost:3000
pnpm dev:worker    # scaffold only, no-op in v0
```

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Status

v0 scaffold: architecture, database schema (7 MVP tables), Traccar webhook
ingest, SSE stream route, Docker dev infra. No dashboard UI, no BullMQ, no
history/geofences/alerts/billing yet — see docs/ARCHITECTURE.md for what's
intentionally deferred.
