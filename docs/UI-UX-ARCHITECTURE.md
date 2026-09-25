# RIO GPS: frontend architecture

How the web UI is put together after the modernization (see `UI-UX-AUDIT.md` for the
baseline and `UI-UX-IMPLEMENTATION.md` for the phase log and measurements).

## Principles
1. **The server is the authority.** Organization, user and permissions come from the session
   (`getRequestContext` / `requireTenantContext`); every API re-checks permissions. UI hiding a
   button is convenience, never security.
2. **Server components by default.** Pages fetch their first data on the server (one round trip,
   no loading flash); client components handle interaction only.
3. **Large collections are paged in SQL.** The browser receives one page (10–100 rows), never the
   whole table.
4. **One design system.** Tokens + primitives; no page-local CSS or inline styles.
5. **Measure before optimizing.** The map rewrite was justified by a CPU profile, not theory.

## Layers
```
app/(auth)/…          sign-in, forgot/reset password (no shell)
app/(app)/layout.tsx  session + org (React cache) → AppShell (sidebar, top bar, search, user menu)
app/(app)/<page>/page.tsx   server: permission check + parse URL query + first data page
app/(app)/<page>/*-view.tsx client: table/filters/dialogs; state in the URL
app/api/**            JSON APIs: assertSameOrigin (writes) → requireTenantContext → requirePermission → zod
lib/**                server logic (SQL, tenancy, audit); lib/client/api.ts is the only client fetch helper
components/ui/**      primitives (Radix where behaviour matters)
components/app/**     app-level building blocks
```

## Design system (`components/ui`, `app/globals.css`)
- Tailwind CSS v4 with tokens in `@theme` (colours incl. status colours, radii, shadows, motion).
- Primitives: Button / IconButton (loading state), Input, Select (native, `select-chevron` utility),
  Textarea, Checkbox, Switch, Badge, Card, Alert, Skeleton, Table, Tabs, Tooltip,
  Dialog / Sheet (Radix: focus trap, Esc, labelled), DropdownMenu (Radix), Sonner toasts.
- App components: `AppShell`, `PageHeader` + `Breadcrumbs`, `DataTable` (TanStack Table in manual
  mode: server sort/paging, column visibility, `aria-sort`, phone card layout with a stretched
  button), `Pagination`, `SearchInput` (debounced), `FilterBar` / `SegmentedFilter`,
  `StatusBadge` (dot **and** text), `EmptyState` / `ErrorState` / `TableSkeleton`,
  `ConfirmDialog` (replaces `window.confirm`), `CommandPalette`, `UnitsProvider`.

## Lists and URL state
- Query schemas (zod) per list: `VehicleListQuery`, `DeviceListQuery`, `AlertListQuery`,
  `TeamListQuery`, `CustomerListQuery`. `parseListQuery` drops only invalid keys.
- `useListParams()` writes `?page=&search=&sort=&direction=&…` with `router.replace`; the server
  page re-renders. Links are shareable; Back works; changing a filter resets to page 1.
- Search input is escaped for `ILIKE` (`\`, `%`, `_`), always parameterized.
- APIs keep their original unparameterized form for existing callers.

## Live map (`app/(app)/map`)
- `useFleetStream`: SSE (snapshot / location / alert / end), reconnect with backoff, 401 → login.
  Device data in a ref; map fed per animation frame; list re-rendered ≤ 1×/s.
- `FleetLayer`: one GeoJSON source (`promoteId`), `updateData` diffs; icons coloured by state and
  rotated by heading; halo for selection; labels when glyphs exist. Display-only interpolation
  (off for reduced motion). No per-vehicle DOM.
- `fleet-model.ts`: pure, unit-tested helpers (state, bearing, interpolation, stats, ranges).
- History panel is loaded on demand; server limits unchanged.
- Map sizing: MapLibre's CSS sets `position: relative` on the map element (unlayered CSS wins over
  Tailwind's layered utilities), so maps are sized through a wrapper.

## Units
Stored data is metric (km, km/h). `organizations.unit_system` (default imperial) drives
`useUnits()` for display and for converting user input (speed limits, maintenance intervals,
odometer) before it's sent. Reports CSV and emails use the same setting.

## Security-relevant UI rules
- CSP is nonce-based with `'strict-dynamic'`. **Don't render a `next/dynamic` component on the
  server** (mount it when opened): Next emits a nonce-less `<link rel=preload>` for it that the
  CSP blocks.
- Never render HTML from data: map popups and tooltips are built with `textContent`.
- Full IMEIs never reach the browser (last 4 for `devices.manage` only).
- One-time passwords are held in component memory only and shown once.

## Accessibility conventions
Skip link; one `<main>`; labelled landmarks; every control has an accessible name; status is
text + colour; dialogs trap focus and close on Esc; tables use `scope`/`aria-sort`; the map
canvas is labelled and every map action has a list/button equivalent; `prefers-reduced-motion`
disables vehicle gliding.

## Adding a page (checklist)
1. `page.tsx` (server): `getRequestContext()`, permission check → redirect, parse query, fetch.
2. View (client): `PageHeader`, `Card` + `DataTable` or content, empty/error/loading states.
3. API: same-origin check for writes, tenant context, permission, zod, audit.
4. Nav: add to `nav-config.ts` with its permission.
5. Tests: integration test for tenant isolation and permissions; Playwright smoke at 390 and 1440.
