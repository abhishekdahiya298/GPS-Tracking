# RIO GPS: UI/UX audit (Phase A baseline)

Date: 2026-09-25 · Baseline commit: `8b8fee2` (production) · Scope: `apps/web` frontend.
The backend, GPS pipeline, auth, RBAC and infrastructure are **out of scope** for change;
they are listed only where the UI depends on them.

## 1. Current architecture

| Area | Today |
|---|---|
| Framework | Next.js 15.5 App Router, React 18.3, TypeScript. Every route `force-dynamic` (per-request CSP nonce). |
| Pages (15) | `/`, `/login`, `/forgot-password`, `/reset-password`, `/dashboard`, `/map`, `/vehicles`, `/geofences`, `/alerts`, `/reports`, `/reports/schedules`, `/maintenance`, `/settings/team`, `/settings/account`, `/admin/customers` |
| Page pattern | Server component resolves session + tenant + permission, then renders **one large client component** (`*-manager.tsx`) that owns all state, fetches and forms. |
| Client components | 16 files, 2,445 lines. Largest: `live-map.tsx` 472, `maintenance-manager` 280, `alerts-manager` 273, `geofence-editor` 223, `vehicles-manager` 217. |
| Styling | **No design system.** 216 inline `style={{…}}` blocks; one CSS module (`map.module.css`, 34 lines); browser-default buttons/inputs; `system-ui` font. |
| Data fetching | Server components for first render; client `fetch` helpers **re-implemented in 8 files** (`api()` / `call()`), each with its own error parsing and 401 handling. No caching layer; mutations refetch the whole list. |
| Map | MapLibre GL 5 + OpenFreeMap "liberty". Vehicles are **DOM markers** (`maplibregl.Marker`); track and zones are GeoJSON layers. SSE (`/api/locations/stream`) with snapshot + reconnect. |
| Security coupling | CSP: `style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`, `connect-src 'self' tiles.openfreemap.org`. Forms use `method="post"` (pre-hydration safety). Mutations: same-origin check, tenant from session, RBAC server-side. |
| Tests | Vitest unit (core 44, web 17) + integration 112 (auth, tenancy, SSE, CRUD, alerts, reports, onboarding, devices, maintenance). **No component/UI tests.** Playwright is available for smoke tests. |

### Measured baseline (production build, `next build`)
| Route | Route JS | First load JS |
|---|---|---|
| Shared by all | — | **102 kB** |
| /dashboard, /login | 0.5–0.9 kB | 114 kB |
| /vehicles, /alerts, /reports, /team, /maintenance, /customers | 2–3.6 kB | 104–105 kB |
| **/map** | 5.5 kB | **393 kB** (MapLibre ≈ 285 kB) |
| **/geofences** | 3.6 kB | **391 kB** |
| Middleware | — | 35 kB |

Page JS is already small. Map pages are dominated by MapLibre, which is unavoidable, but it
could be split so the page frame shows before the map library loads.

## 2. Current problems (summary)
1. **No shared layout or navigation.** Each page renders its own header of links (7 copies, inconsistent sets and order). No active-state, no mobile menu.
2. **No component library.** Buttons, inputs, cards, badges, status colours, tables and messages are hand-styled per page with inline styles, so spacing, colours and fonts vary page to page.
3. **Duplicated logic:** 8 copies of the fetch helper; 6 hand-built "message box" patterns; ad-hoc confirmation via `window.confirm`.
4. **No tables:** vehicles, devices, team, customers, alerts and trips are rendered as flex rows or basic `<table>`s with no search/sort/filter/pagination.
5. **Units:** speeds/distances are km/h / km only. Target market is USA (mph/mi) + Canada (km/h/km).

## 3. Performance problems
| # | Problem | Evidence | Impact |
|---|---|---|---|
| P1 | **Every GPS update rebuilds every vehicle marker.** The marker effect runs on each `devices` state change and calls `existing.remove()` + `new Marker()` for *all* devices. | `live-map.tsx` L218–253 | O(n) DOM churn per position; at 200 vehicles reporting every 10 s ≈ 20 marker rebuilds/s × 200 = 4,000 DOM ops/s. Popups close on update. Fine for 1 vehicle, not for fleets. |
| P2 | No batching of SSE events | each event → `setDevices` → re-render | bursts after reconnect cause many renders |
| P3 | Lists fetch **all rows** | `listVehicles`, `listDevices`, `listMembers`, `listCustomers` have no limit | fine now (1–2 rows), grows linearly |
| P4 | Maintenance status runs one SQL distance query per item per page view | `listItems` | OK for tens of items; needs batching past ~100 |
| P5 | Map library loads before the page frame paints | static `import maplibregl` | slower first paint on /map on mobile |
| P6 | Dashboard lists every device inline | `dashboard/page.tsx` | unbounded page size |

Not problems: route JS is small; SSE uses a shared hub; history API is already paginated (cursor, max 5,000/page) and alerts are paginated (`beforeId`).

## 4. UX problems
- **First-time customer:** the dashboard is a plain list; no summary, no "what to do next", no empty states with actions.
- **Map:** starts on a hard-coded Los Angeles view until the first fit; no filters (moving/idle/offline), no search, no fit-all, no fullscreen; the history panel is a raw form; playback has no timeline.
- Forms are long, single-column, all fields visible at once (customer onboarding, schedules, maintenance).
- Feedback is a single status line at the top of the page; success and errors look the same except border colour; they do not auto-dismiss.
- Destructive actions use the browser `confirm()` dialog.
- Naming differs between pages: "Zones" vs `/geofences`, "Vehicles & devices".
- Times are shown in the browser locale inconsistently (some UTC strings on the dashboard).

## 5. Accessibility problems
- Status is often colour-only (map markers, connectivity dots, badges on alerts).
- No visible focus styles beyond browser defaults; small click targets (< 32 px) on mobile.
- `window.confirm` and custom panels have no focus management; no `aria-live` region for results/errors in most pages.
- Map vehicles are only reachable by clicking markers (list exists but lacks keyboard selection state).
- Headings skip levels on some pages; several icon-less buttons are fine, but a few text links act as buttons.

## 6. Mobile problems
- No navigation on mobile: header links wrap into several lines.
- Tables/rows overflow at 375 px (customers table, trip table, alerts).
- Map page: side panel stacks below the map; the map loses most of the viewport.
- Forms use fixed min-widths that cause horizontal scroll in places.

## 7. Scalability problems
- No server-side search/sort/pagination for vehicles, devices, team, customers.
- Map DOM markers (P1).
- Dashboard renders every device.
- No global search.

## 8. Recommended solution
Keep the architecture (server components for auth + first data, focused client components for interaction). Add:

1. **Design system**: Tailwind CSS v4 (build-time, static CSS served from `'self'`, so CSP-safe),
   shadcn-style components written into `src/components/ui` (source we own, no runtime framework),
   Radix primitives only where behaviour is hard (Dialog/Sheet, DropdownMenu, Tooltip, Tabs, Popover),
   `lucide-react` icons (tree-shaken), `sonner` toasts. System font stack (no web-font fetch; CSP `font-src 'self'` unchanged).
2. **App shell** in a route-group layout: sidebar + top bar + mobile slide-over, permission-aware nav built server-side from `TenantContext`.
3. **One client API helper** (`lib/client/api.ts`) with consistent errors, 401 redirect and toast integration.
4. **DataTable** on TanStack Table (headless, ~15 kB) with server-side `page/pageSize/search/sort/direction` for vehicles, devices, team, customers; alerts keep their existing cursor pagination.
5. **Map**: vehicles as one GeoJSON source + circle/symbol layers, SSE events batched per animation frame, presentation-only interpolation between fixes, fit-to-fleet then North America fallback, filters/search/fit/fullscreen, mobile bottom sheet, improved history with quick ranges + timeline.
6. **Units** preference (mi/mph vs km/km/h) as a presentation concern; stored values stay metric.
7. **Global search** (Ctrl/Cmd K) backed by one server endpoint returning ≤ 5 results per type.
8. TanStack Query: **not adopted initially.** Pages are server-rendered with small client islands; a tiny `useApi` hook + `router.refresh()` covers current needs. Re-evaluate for the vehicles table if client-side paging becomes complex.
9. React Hook Form: adopt for multi-field dialogs (vehicle, customer wizard, reminders) with the **same zod schemas** exported from `lib/*` so validation isn't duplicated; the server remains authoritative.

## 9. Proposed component architecture
```
src/
  components/
    ui/            button, input, select, textarea, checkbox, switch, label, badge, card,
                   dialog, sheet (drawer), dropdown-menu, tooltip, tabs, alert, skeleton,
                   separator, table
    app/           app-shell, sidebar, topbar, mobile-nav, user-menu, nav-config (RBAC-aware),
                   page-header, empty-state, error-state, status-badge, confirm-dialog,
                   loading-button, data-table (+ pagination, search-input, filter-bar),
                   command-palette
  lib/client/      api.ts (fetch + errors), use-api.ts, format.ts (units, time), cn.ts
  app/(app)/       layout.tsx (shell) + all signed-in routes
  app/(auth)/      login, forgot-password, reset-password (centered card layout)
```
Rules: no inline styles in new code (except dynamic values like colours from data); every
list page has loading / empty / error states; nav items come from one config filtered by
`contextHasPermission` (server-side), and every API keeps its own server check.

## 10. Implementation phases
| Phase | Content | Risk controls |
|---|---|---|
| A | This audit + architecture doc | none |
| B | Tailwind v4 + UI primitives + tokens + Sonner; verify production Docker (Node 20 Alpine) builds | Docker build test; CSP unchanged |
| C | App shell (route groups), RBAC nav, mobile nav, auth pages restyled | all integration tests + Playwright smoke per route |
| D | Dashboard: summary cards, fleet status, recent alerts, recent trips, quick actions, empty states | server-side aggregates, one round trip |
| E | Vehicles + Devices: DataTable, server pagination/search/sort, vehicle detail sheet, dialogs | new list params validated with zod; tenant tests |
| F | Map: GeoJSON layers, rAF batching, interpolation, filters, fit, fullscreen, history UX, mobile sheet | SSE tests; manual live check; measure marker update cost before/after |
| G | Reports + schedules UI | business logic untouched; existing report tests |
| H | Alerts + Zones + Maintenance UI | existing tests |
| I | Team + Customers (wizard, detail, device registration flow) | last-admin + super-admin tests |
| J | Global search (Cmd/Ctrl K) | server endpoint tenant-scoped + tests |
| K–N | Responsive pass (375→1920), accessibility pass, performance measurement, final QA + docs | Playwright screenshots at 7 widths |

Each phase: typecheck, lint, unit + integration tests, production build, Playwright smoke,
reviewed diff, one commit. No deploy until requested.

## Owner decisions (2026-09-25)
1. **Units:** organization setting, **default mph / miles**; Canadian customers can switch to km/h / km. One additive column (`organizations.unit_system`). Stored GPS data stays metric and exact; conversion is presentation-only (UI, reports, CSV, emails).
2. **URLs:** keep existing paths (emails and bookmarks keep working) and add aliases: `/zones` → `/geofences`, `/devices` → device list, `/account` → `/settings/account`.
