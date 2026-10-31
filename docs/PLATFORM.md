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
