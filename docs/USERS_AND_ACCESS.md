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

## Managing the team (web UI)

**Settings → Team** (`/settings/team`):

- **Who can use it:** Org Admin and Fleet Manager can view it; only Org Admin can make changes.
- **Add member:**
  - A brand-new account gets a random 20-character temporary password. It is shown **once**, never stored in plain text and never logged.
  - An email that already has an account, for example from another organization, just gets access. Its name and password are left untouched.
- **Change role / Remove:** the organization always keeps at least one Org Admin. Removing someone signs them out everywhere immediately.
- **Reset password:**
  - Issues a new one-time temporary password and signs the person out everywhere.
  - It is refused for accounts that also belong to another organization, and for platform super admins, unless a super admin does it. This stops an admin of one customer from taking over an account that also has access to another customer.

**My account** (`/settings/account`): anyone can change their own password. The current password is required, and other devices are signed out.

Every action is audited:

- `member.added`, `member.role_changed`, `member.removed`, `member.password_reset`
- `auth.password_changed`

Self-service "forgot password" emails arrive once Resend is configured.

## Integration tests

These need a disposable Postgres database whose name contains `test`, plus a Redis instance:

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/rio_test \
TEST_REDIS_URL=redis://127.0.0.1:56379 pnpm --filter @rio-gps/web test:integration
```
