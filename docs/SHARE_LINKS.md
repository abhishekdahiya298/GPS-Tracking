# Share links

A temporary public link that lets someone outside the organization (a customer waiting for
a delivery, for example) see **one vehicle's current position** without signing in.

- **Create**: Vehicles → row menu → **Share live location**. Choose how long it works
  (1 hour to 30 days, default 24 hours) and an optional private note. The link is shown
  **once**; copy it then. Permission: `vehicles.update` and `locations.read` (Org Admin,
  Fleet Manager).
- **Turn off**: the same dialog lists the vehicle's active links, when each expires and when
  it was last viewed. Turning one off takes effect immediately.
- **What the visitor sees** (`/share#<token>`): the vehicle's name, a map with its current
  position, moving/stopped and speed, when the position was recorded, and when the link
  expires. The page refreshes every 15 seconds.

## Security design
This is the only place location data leaves the authenticated app.

| Risk | Control |
|---|---|
| Guessing a link | Token is 256 random bits (43 base64url characters) |
| Database leak reveals links | Only the token's SHA-256 is stored; the link can't be read back |
| Link lives forever | Expiry is mandatory (max 30 days); revocable; limits of 20 active links per vehicle and 500 per organization |
| Over-sharing | The public response has exactly: vehicle name, expiry, units, time zone/clock, and the current position (lat, lon, speed, heading, ignition, fix time). No history, other vehicles, device ids/IMEI, plate, organization name, or the private note. A test pins this field list |
| Token in logs or Referer | The token is in the URL **fragment** and sent in a POST body, so it never appears in a request URL (Caddy/app logs). The page sends no Referer (`Referrer-Policy: no-referrer`), so the map tile provider doesn't see it either |
| Probing which links exist | Unknown, malformed, expired and revoked tokens get the same 404 body |
| Search engines | `noindex, nofollow` (header and meta) |
| Abuse / load | 120 requests per minute per client address (Redis; fails open with a log line if Redis is down, since the token is the real protection); `Cache-Control: no-store` |
| Reaching the rest of the app | The page has no session; every other API still requires sign-in |
| Stale sharing | The link follows the vehicle: if its tracker is unassigned or deactivated, no position is shown; deleting the vehicle deletes its links |
| Accountability | `share_link.created` / `share_link.revoked` in the audit log (never the token) |

## Data (migration 0011, additive)
`share_links`: organization_id, vehicle_id, token_hash (unique), label, expires_at,
revoked_at, created_by, view_count, last_viewed_at.

## API
- `GET /api/share-links[?vehicleId=]`, `POST /api/share-links` `{ vehicleId, hours?, label? }`
  → `{ id, token, expiresAt }`, `DELETE /api/share-links/{id}` (authenticated, same-origin).
- `POST /api/share/view` `{ token }` (public, same-origin, rate-limited).

## Operations
- Turn off every link of an organization at once (emergency):
  `update share_links set revoked_at = now() where organization_id = '<id>' and revoked_at is null;`
- `view_count` counts page refreshes (4 per minute per open page), not people.
