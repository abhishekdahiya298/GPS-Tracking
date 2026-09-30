# Time zones and clock

How RIO GPS handles time for fleets across Canada and the United States. It follows the
model used by the mainstream fleet platforms: store instants in UTC and apply time zones
only when showing or grouping them.

## Rules
1. **Every instant is stored in UTC** (`timestamptz`): GPS fixes, alerts, trips, audit logs and
   service records. Nothing is ever stored as local time, and changing a time zone never
   changes data.
2. **Each organization has a default zone and clock** (`organizations.time_zone`, IANA name;
   `organizations.time_format`, `12h` | `24h`). New organizations are created with the zone
   picked in the customer wizard (default `America/Toronto`). Migration 0007 set existing
   organizations to `America/Toronto` / `12h`.
3. **Each user may override both** (`users.time_zone`, `users.time_format`; `NULL` = follow the
   organization). Example: a dispatcher in Vancouver working for a Toronto fleet.
4. The **effective** zone/clock (user's choice, else organization's) is resolved **on the
   server** for each request (`getRequestContext`, `getTimePrefs`) and passed to the browser
   (`TimeProvider` / `useTime()`). The device's own clock and zone are never used for
   display, so every screen, report and email for the same person agrees, and server and
   browser render the same text (no hydration mismatches).
5. **Daylight saving time** comes from the IANA database (via `Intl`). Day boundaries are
   computed per day, so DST change days are 23 or 25 hours long, and zones without DST
   (Saskatchewan, Yukon, Arizona, Hawaii) are handled with no special cases.

## Where the zone is applied
| Place | Behaviour |
|---|---|
| All screens | `useTime()` formatters (`dateTime`, `full`, `date`, `time`, `day`…); hover shows full date, seconds and zone (e.g. "Sep 25, 2026, 3:52:07 PM EDT") |
| "Today", "Yesterday", "7 days", date pickers | Local calendar days in the effective zone (`startOfLocalDay`, `wallTimeToUtc`) |
| Map history custom range | `datetime-local` inputs are wall-clock time in the effective zone, labelled "Times in EDT" |
| Trip reports + CSV | Days and trip times in the zone; CSV uses 24-hour `YYYY-MM-DD HH:mm` plus a `time_zone` column (abbreviation at trip start) |
| Alerts list date filter | Local days in the viewer's zone (API: optional `tz`, defaults to the caller's zone) |
| Alert emails | Each recipient's own zone and clock |
| Scheduled report emails | The schedule's own zone (defaults to the creator's zone when creating) |
| Maintenance service dates | A picked calendar day is stored as local noon in the zone (never slips a day) |

## Settings
- **Settings → Organization** (Org Admin): time zone and clock, with a live preview.
- **Settings → My account** (everyone): personal zone and clock, "Organization default"
  option, and a "Use this device's time zone" shortcut.
- **Admin → Customers → New customer** (platform admin): the customer's zone; units follow
  the zone (Canada → km, US → miles) until changed.

The picker lists Canada (Pacific, Yukon, Mountain, Saskatchewan, Central, Eastern, Atlantic,
Newfoundland) and the United States (Hawaii, Alaska, Pacific, Arizona, Mountain, Central,
Eastern, Puerto Rico) with the current abbreviation and UTC offset, then every other IANA
zone. Zones are validated and stored in canonical form (`US/Eastern` → `America/New_York`).

## APIs
- `GET/PATCH /api/organization`: `{ unitSystem?, timeZone?, timeFormat? }` (`organization.manage`, same-origin, audited).
- `GET/PATCH /api/account/preferences`: `{ timeZone: string | null, timeFormat: "12h" | "24h" | null }`: the signed-in user's own row only; audited as `user.preferences_updated`.
- `GET /api/reports/trips?…&tz=` and `GET /api/alerts?…&tz=`: `tz` is optional and defaults to the caller's effective zone.

## Code
- `packages/core/src/timezones.ts`: zone catalog, validation/canonicalization, abbreviations and offsets, cached formatters, DST-safe wall-time ↔ UTC. Unit-tested, including DST gaps/overlaps and half-hour zones.
- `apps/web/src/components/app/time-context.tsx`, `local-time.tsx`, `time-zone-select.tsx`.
- Letter abbreviations (EDT, PST, NDT…) are used only for the curated North American zones, where Node and browsers agree; other zones show the numeric offset (UTC+5:30).
