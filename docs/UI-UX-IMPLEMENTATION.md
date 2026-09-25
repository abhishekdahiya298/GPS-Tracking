# RIO GPS: UI/UX modernization, implementation log

Plan and baseline: `docs/UI-UX-AUDIT.md`. Each phase: typecheck, lint, unit + integration
tests, production build, Playwright smoke at desktop and phone widths, reviewed diff, one
commit. Nothing is pushed or deployed without the owner's go-ahead.

## Completed phases

| Phase | Commit | Summary |
|---|---|---|
| A | `0c9b6b9` | Baseline audit + phased plan (`docs/UI-UX-AUDIT.md`) |
| B | `3569edb` | Design system: Tailwind v4 tokens, UI primitives (Button, Input, Select, Dialog/Sheet, DropdownMenu, Tabs, Tooltip, Badge, Card, Alert, Skeleton, Switch, Table), Sonner toasts |
| C | `58306ca` | Responsive app shell: sidebar grouped by Tracking / Operations / Administration, mobile slide-over nav, top bar, user menu, nav filtered by RBAC, skip link |
| (units) | `2fb7062` | Organization display units (mph / miles default, km option); additive column `organizations.unit_system` (migration 0006) |
| D | `aa95188` | Dashboard: summary cards, fleet status, recent alerts, recent trips, quick actions, empty states, one server round trip |
| E | `d0106b0` | Vehicles + Devices: server-side paginated/searchable/sortable/filterable lists, reusable DataTable (TanStack Table), vehicle detail sheet, react-hook-form dialogs, confirm dialogs |
| F | `19bc1c1` | Live map rebuilt on a GeoJSON layer; history + playback; mobile bottom sheet |
| G | `cab1e02` | Reports: filter card with quick ranges, URL-shareable state, summary cards, by-day and sortable/paged trips tables, phone cards, CSV button, skeleton/empty/error states, organization units (was always km). Email schedules: cards with status, action menu, create dialog, confirm-before-delete, toasts |
| H | `725a045` | Alerts (server-paged history + filters, severity, detail sheet, rules tab), Zones, Maintenance, map `?focus=` |
| I | `f7f6cd2` | Team (server-paged table, role/status, action menu, dialogs) and Customers (paged table, 3-step create wizard, customer detail page with device registration and view-as) |
| J | (this commit) | Global search / command palette (Cmd/Ctrl+K), server-side and permission-checked |

## Phase F: map performance and UX

### Measured before/after
Local production build, 500 simulated vehicles (local test DB only), GPS events streamed
through the real webhook → SSE path for 15 s, headless Chromium at 1440×900.

| Metric | Before (DOM markers) | After (GeoJSON layer) |
|---|---|---|
| DOM nodes on page | 4,192 | **326** |
| JS + DOM + GC main-thread time, 20 updates/s (CPU profile) | ≈ 2.1 s | **≈ 0.4 s** |
| Long tasks, 20 updates/s, DOM-only rendering | 15 (961 ms, worst 131 ms) | see note |
| Long tasks, 60 updates/s | 29 (2.2 s, worst 276 ms) | see note |

**Root cause of the old cost:** every GPS event (any vehicle) removed and recreated *every*
marker and popup (`markers.forEach(remove)` + `new Marker` per device) and re-rendered the
whole list. Cost grew with fleet size × event rate.

**Note on the sandbox GPU:** the test machine has no GPU, so WebGL is rasterized in software
on the main thread ("(program)" ≈ 12 s in the profile). The old version didn't repaint the
canvas for DOM-marker moves, so a raw long-task count isn't comparable there. The CPU
profile isolates JS/DOM work, which is what this change targets; on real hardware the canvas
draw of a few hundred icons is GPU work.

### Architecture
```
SSE (snapshot / location / alert / end)
  → useFleetStream: devices in a ref (no React state per event)
      → rAF-batched flush → FleetLayer.upsert(changed)
            → GeoJSON source (promoteId) → updateData(diff) per frame, setData only on snapshot/add/remove
      → list re-render at most 1×/s (windowed: only visible rows mounted)
```
- `fleet-model.ts`: pure helpers (state, bearing, interpolation, stats, quick ranges), unit-tested.
- `fleet-layer.ts`: one source, layers `fleet-halo` (selection), `fleet-icons` (status colour,
  rotated by heading), `fleet-labels` (zoom ≥ 10, only when the style has glyphs).
- Smooth movement is presentation-only interpolation (≈ 0.9 s ease between fixes, ≤ 30 fps,
  only at zoom ≥ 9, ≤ 400 simultaneous, off for `prefers-reduced-motion`). GPS data is never
  changed; history and reports read the stored fixes.
- Offline is re-evaluated every 30 s from `last_seen` (server threshold passed from the page).

### UX
- Filters All / Moving / Idle / Offline with counts, search by name/plate, list ↔ map in sync.
- Click (map or list) selects: halo + popup (built with `textContent`, no HTML injection); hover
  shows the name; Center and History actions.
- Fit all, fullscreen, zoom controls. Initial view: fit the fleet; if nothing has a position yet,
  a North America overview (no hard-coded California).
- History: Today / Yesterday / 7 days / Custom; play/pause, 1×/10×/60×/300×, timeline slider,
  time, speed, distance so far / total, max speed. Server limits unchanged (5,000 per page,
  20,000 max); history panel is loaded on demand.
- Mobile (< 768 px): full-screen map with a bottom sheet (peek → 70%).
- Live alerts appear as Sonner toasts with a "View" action.
- Reconnect verified: server killed with the map open → "Reconnecting…" → "Live", and live
  GPS continued afterwards.

## Phase G notes
- Business logic unchanged: same `/api/reports/trips` and trip detection; CSV already in org units.
- A report is one vehicle over ≤ the server's max range, so sorting/paging the trips client-side needs no extra requests.
- Design-system fix found here: the native `<select>` chevron used an arbitrary `bg-[url(...)]` class that Tailwind didn't compile and that made tailwind-merge drop `bg-background`, so every select rendered grey with no arrow. Replaced by a `select-chevron` utility in `globals.css`.

## Phase H: Alerts, Zones, Maintenance
- **Alerts**: server-side paged list (`/api/alerts?page=&pageSize=&status=&type=&search=&from=&to=&tz=`, zod-validated, org-scoped, wildcards escaped; date filters are local calendar days in the viewer's time zone). The legacy `?limit=&unacknowledged=&beforeId=` form is unchanged. History tab: status (All / New / Acknowledged) with counts, type, date range, search, severity badges (text + colour), detail sheet with "Show track on map" (±15 min), acknowledge / acknowledge all. New live alerts refresh an unfiltered first page, otherwise show "N new alerts, refresh". Rules tab: switch to pause, email toggle, create dialog with the speed limit entered in the organization's unit (stored km/h), confirm before delete. Alert logic unchanged.
- **Zones**: design-system panel, search, click a zone to fit it, rename/colour dialog, confirm before delete, colour picker, radius shown in ft/mi (imperial). Starts on the zones, else the fleet, else North America (was hard-coded Toronto). Enable/disable not offered: zones have no active flag and adding one would be a schema change.
- **Maintenance**: status filter + search, vehicle cards, add / mark-serviced dialogs, intervals and odometer entered and shown in the organization's units (stored km), confirm before delete, presets in miles for US fleets.
- **Map**: `/map?focus=<device>` (Vehicles → Show on map) now selects and centres the vehicle; the selected row is scrolled into view in the windowed list.
- **A11y fix**: MapLibre already marks its canvas as a region; the extra wrapper region was removed and the canvas labelled ("…Use the list for keyboard access").
- Tests: `alerts-list.itest.ts` (paging, counts, tenant isolation, each filter, wildcard escaping, time-zone day boundaries, invalid params, legacy form).

## Phase I: Team and Customers
- **Team** (`/settings/team`): `/api/team?page=&pageSize=&search=&role=&sort=&direction=` (SQL, org-scoped, escaped search; the unparameterised form is unchanged). Columns Member / Role / Last active / Status (Active, or Invited = never signed in) / actions. Action menu: Change role (dialog explaining each role), Reset password (confirm), Remove (confirm). Add member dialog; if email can't be sent the one-time password is shown once in a dialog with Copy. Server rules unchanged: last-admin protection (its error is shown in the role dialog), org-only credential resets, RBAC.
- **Customers** (`/admin/customers`, platform admins only): `/api/admin/customers?page=&search=&sort=` (super-admin check unchanged), columns Customer / Users / Devices (active in 24 h) / Created / Status, actions Manage / View as. "New customer" is a 3-step wizard (company with auto short-name → first admin → review → create; one-time password shown only if email fails). New **customer detail page** `/admin/customers/[id]`: devices (IMEI last 4 only), users, Register device dialog (15-digit hint, Traccar failure shown, nothing saved), View as customer.
- **CSP finding**: a lazily loaded component that is rendered during server rendering makes Next emit a `<link rel="preload" as="script">` **without** the nonce, which the strict CSP blocks (console error, wasted preload; the feature itself still worked). Fixed by mounting the wizard only when opened. All 13 main routes were then scanned: 0 nonce-less scripts or script preloads.
- Tests: `team-list.itest.ts`, `customers-list.itest.ts` (403 for org admins on the paged form, paging/search/sort, detail exposes only IMEI last 4).

## Phase J: global search (Cmd/Ctrl + K)
- `GET /api/search?q=` (2–100 chars): server-side, org-scoped, each group permission-checked like its page (vehicles.read, devices.read, alerts.read, geofences.read, users.read; customers only for platform admins), ≤ 5 hits per group, search wildcards escaped. Admins (devices.manage) can find a unit by trailing IMEI digits; the IMEI is never returned.
- Palette in the top bar (button + Cmd/Ctrl+K): "Go to" pages from the permission-filtered menu, then Vehicles, Devices, Alerts, Zones, Team, Customers. Accessible combobox/listbox (aria-activedescendant, arrow keys, Enter, Esc, focus trapped by the dialog), 200 ms debounce, stale requests aborted, error state. Results link into the existing pages' URL filters (e.g. `/vehicles?search=`).
- Tests: `search.itest.ts` (5-per-group cap, tenant isolation, permission gating incl. IMEI digits, customers only for super admins, short/wildcard queries).

## Remaining phases
 Alerts + Zones + Maintenance · I Team + Customers · J Global search ·
K–N Responsive, accessibility, performance, final QA + `docs/UI-UX-ARCHITECTURE.md`.

## New dependencies so far
tailwindcss 4 + @tailwindcss/postcss, class-variance-authority, clsx, tailwind-merge,
@radix-ui (dialog, dropdown-menu, slot, tabs, tooltip), lucide-react, sonner,
@tanstack/react-table, react-hook-form + @hookform/resolvers. No map library change
(MapLibre GL 5 + OpenFreeMap kept). No new state-management library.
