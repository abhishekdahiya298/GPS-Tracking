# Platform console and platform admins

RIO GPS staff manage every customer from the **platform console** (`/admin`). They are *platform admins* (`users.is_super_admin`), which is not an organization role.

## Platform admins are never organization members

- A platform admin signs in to the platform console. They have no company of their own and no membership rows.
- To work inside a customer they use **View as customer** (customer list, customer page or search). That sets the session's customer (`sessions.active_organization_id`), is written to the activity log (`admin.view_as_started` / `admin.view_as_ended`), and gives full access there (role `null`, every permission). A banner shows it on every page; **Exit customer view** goes back to the console.
- `resolveTenantContext` ignores any membership a platform admin still has, and with no customer chosen it throws `PlatformOnlyError`: customer pages redirect to `/admin`, customer APIs answer 403.
- A platform admin can't be added as a member (Team → Add answers 409) and can't be a new customer's first administrator.
- Create one with the CLI (no organization): `pnpm admin:create-user --email ops@example.com --name "Ops" --super-admin`.

## Console pages

| Page | What it is for |
|---|---|
| Overview `/admin` | Customers, trackers online, silent trackers, customer users; customers that need attention (silent trackers, no trackers, nobody signed in, suspended); system health (database, Redis, latest position, live streams); newest customers; recent platform activity |
| Customers `/admin/customers` | Every customer with users, trackers and status; tabs Current / Suspended / Archived / All; New customer; per customer: Manage, View as customer, Suspend / Reactivate, Archive / Restore |
| Customer page | Trackers, users, register / bulk import trackers, status banner and **Customer status** actions |
| Trackers `/admin/trackers` | Every tracker with its customer; filters Online / Silent 24 h+ / Never reported / Deactivated; search by name, model, customer or IMEI digits (only the last 4 are shown) |
| Leads `/admin/leads` | Pricing requests from the public site |
| Activity log `/admin/activity` | The audit log across all customers; platform admins' actions by default, or everyone's |

## Customer status (soft delete)

Nothing is ever hard-deleted from the console. `organizations.status` is `active`, `suspended` or `archived`, with `status_reason`, `status_changed_at` and `status_changed_by`; every change is audited (`customer.suspended`, `customer.archived`, `customer.restored`).

|  | Users can sign in (web + app) | Alerts, emails, push, scheduled reports | Driver / shipper / shared links | Tracker positions stored |
|---|---|---|---|---|
| Active | yes | yes | yes | yes |
| Suspended (e.g. unpaid) | no | no | no (404) | yes, so no history is lost |
| Archived (customer left) | no | no | no (404) | no |

- Suspend and archive need a reason; archive also needs the customer's name typed.
- A person who belongs to another active company keeps working there; the company switcher hides unavailable ones. Someone with no usable company sees `/no-access` ("Account suspended" / "Account closed").
- Platform admins can still open a suspended or archived customer (with a banner).
- Archived customers are hidden from the Current list and can't get new trackers; their trackers stay registered to them so Restore puts everything back. Positions sent while archived are not kept.
- The ingest path reads the status from a 30-second per-process cache, so another server process may store positions for up to 30 seconds after archiving.
- Permanent deletion (purge) is deliberately not in the app.

## Editing customers and their users

- **Edit details** on a customer's page: company name, short name, account contact (name, phone, billing email), internal notes (platform only), time zone, units and clock. Audited as `customer.updated` (contact details and notes are recorded as changed, not copied into the log).
- **Users** on a customer's page: Add user (invitation email, or a one-time temporary password when email is off), Edit name, Change role, Reset password, Turn off two-step, Remove. Same rules as the customer's own Team page: a company keeps at least one Org admin. Archived customers are read-only until restored.
- Everyone can fix the spelling of their own name under **My account** (`user.name_changed`).

## Tracker inventory

Every tracker RIO owns is one row in `gps_devices`; `organization_id` null means it is in RIO's stock.

| Step | Where | What happens |
|---|---|---|
| Add to stock | Trackers → Add to stock / Bulk add | Registered in Traccar at once, so it can be powered on and tested before shipping (positions from stock trackers are not stored). Bulk add takes pasted lines: IMEI, and optionally the SIM's ICCID and phone number in any order. |
| Assign | Trackers → Assign, or Add tracker on the customer's page (a stock IMEI is handed over) | The tracker joins the customer and appears on their Devices page. |
| Move | Trackers or customer page → Move to another customer | Reason required. Taken off its vehicle; latest position, alert state and the customer's name for it are cleared. Positions, trips and alerts stay with the first customer (every row carries its own organization). Audited for both customers. |
| Return | → Return to stock (optionally retire) | Same clean-up; back in stock. |
| Retire / put back | Stock trackers only | Faulty, lost or end of life; retired trackers can't be assigned. |

Platform pages show the full IMEI (staff match it against labels); customers' own pages still show only the last 4 digits. Daily summaries are keyed by organization too, so a tracker moved mid-day keeps one row per customer.

## SIM cards

`sim_cards`: ICCID (unique), phone number, carrier, plan, APN, status (`inventory` = not activated, `active`, `suspended`, `cancelled`), monthly cost, notes, and the tracker it is in (one SIM per tracker).

- Add one, import the carrier's list (ICCID, optional phone, optional IMEI to put it in), or add SIMs with their trackers.
- **Needs attention**: an active SIM that is not in a customer's tracker (billed for nothing), and a SIM that is not active in a tracker that is with a customer (it can't report). The page header shows the monthly total and the amount spent on unused SIMs; the overview links to both.
- Change a SIM's status here whenever you activate, suspend or cancel it with the carrier, so the list matches the bill.

### Hologram sync

With `HOLOGRAM_API_KEY` (and `HOLOGRAM_ORG_ID`) in the server's `.env`, the SIM cards page fills itself from Hologram every 6 hours (first run a minute after start; **Sync now** on the page). Read-only: SIMs are still activated, paused and paid for in Hologram.

- Copied per SIM (by ICCID): phone number, status (LIVE → active, PAUSED/FROZEN → suspended, DEAD → cancelled, inactive/test → not activated), plan, APN, carrier "Hologram".
- Tracker, first match wins: (1) the IMEI Hologram last saw the SIM in; (2) an IMEI typed anywhere in the SIM's Hologram name, spaces/dashes allowed (`GPS-868038076566455`, `8680 3807 6566 455`, `Truck 12 / 868038076566455`); (3) a name equal to exactly one tracker's name or serial number in RIO (case, spaces and dashes ignored). One SIM per tracker: a different SIM recorded in that tracker is taken out of it.
- The Hologram name is shown under the ICCID on the SIM cards page and is searchable.
- Kept from RIO: monthly cost (**Set monthly cost…** applies one price to every Hologram SIM) and notes. A SIM Hologram stops listing is never deleted, just no longer refreshed.
- One `sim.synced` activity entry per sync that changed something (or that a person started).

## Plans, modules and usage (manual invoicing)

**Modules.** A plan switches on `gps` (live map, vehicles, trackers, trips, zones, reports, maintenance) and/or `loads`. Each module owns a set of permissions (`MODULE_PERMISSIONS` in `packages/core/src/rbac.ts`); `resolveTenantContext` adds the customer's modules to every request context, so the same `contextHasPermission` check that guards pages, APIs and the menu also enforces the plan, for platform admins viewing the customer too. Team, settings, alerts and billing are in every plan. A Loads-only customer starts at `/loads`, has no Dashboard/fleet menu items, and can only track loads by the driver's phone.

**Catalog vs customer terms.** `plans` is the catalog (console → Billing → Plans). Assigning a plan copies its terms into `subscriptions` (one open row per customer, history kept), where they can be adjusted per customer (e.g. more included loads). Editing a catalog plan never changes what existing customers pay. Every new customer is created on a plan; existing customers were put on "GPS + Loads" when plans were introduced (migration 0022).

**Usage ledger (can't be gamed).**
- `billable_loads`: a load is recorded once (unique load id) when tracking starts: driver accepts the link, or a vehicle-tracked load is created. Loads cancelled/declined before tracking are free. Deleting or cancelling later never removes the row.
- `billable_trackers`: a tracker is recorded once per month it is with an active customer (hourly job + immediately on assign/move).
- Months are calendar months in the customer's time zone.
- After pickup, a load's pickup can't be edited (a new shipment is a new load). Loads tracked longer than 14 days are flagged on the statement for review.

**Over the allowance** work never stops: extra loads are billed at the customer's extra-load price. The Loads list and New load page show a notice at 80% and 100% of the month's included loads.

**Statement.** Console → Billing → Usage & billing: per customer and month (terms in effect at month end), trackers × price, loads used / included, extra loads × price, monthly fee, total; CSV download (`GET /api/admin/billing?month=YYYY-MM`). Customers see their own plan, this month's usage, an estimate and the counting rules on **Plan & usage** (Org admins).
