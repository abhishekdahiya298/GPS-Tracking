# Users, sign-in, and access control

## Model

- **Better Auth** handles email/password sign-in. Sessions are database-backed: 7-day expiry, refreshed daily. The cookie is `__Secure-rio.session_token` (HttpOnly, Secure, SameSite=Lax).
- **Public sign-up is disabled.** An operator creates every account.
- **SUPER_ADMIN** is a platform flag (`users.is_super_admin`). No API can set it.
- **Organization roles** live in `memberships`, one row per user per organization:

| Role | Can |
|---|---|
| ORG_ADMIN | Everything in the org: users, billing, audit log |
| FLEET_MANAGER | Read everything; manage vehicles, device assignment, geofences and alerts |
| DISPATCHER | Read everything; manage alerts |
| VIEWER | Read only |

The source of truth is `packages/core/src/rbac.ts`. Routes never check roles directly. They call `requireTenantContext()` and then `requirePermission()` from `apps/web/src/lib/authz.ts`.

The organization is always derived server-side from the session and memberships. Client-supplied organization IDs (query, body or headers) are ignored.

## Protections

- **Sign-in rate limit:** 5 per minute per IP, stored in Postgres (`rate_limits`).
- **Origin/CSRF:** checks are enforced explicitly, independent of `NODE_ENV`.
- **Audit log:** sign-in, failed sign-in, sign-out and user creation are written to `audit_logs`. Passwords are never logged.

## Create a user (on the VPS)

```bash
cd /opt/rio-gps
docker compose --env-file .env -f infra/docker-compose.yml exec -it web \
  pnpm admin:create-user --email you@example.com --name "Your Name" \
  --org rio-california --role ORG_ADMIN [--super-admin]
```

The script prompts for the password twice with the input hidden. It is never passed as a flag. The minimum length is 12 characters.

## Password reset

Until Resend is configured, reset passwords by admin action: delete the user's credential account and recreate the user. A self-service reset email flow arrives with Resend.

## Integration tests

These need a disposable Postgres database whose name contains `test`, plus a Redis instance:

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/rio_test \
TEST_REDIS_URL=redis://127.0.0.1:56379 pnpm --filter @rio-gps/web test:integration
```
