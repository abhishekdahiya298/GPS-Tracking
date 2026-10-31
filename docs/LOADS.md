# Loads (broker tracking)

A broker tracks a shipment through the driver's phone, with the driver's consent, from pickup to delivery.

## Flow

1. **Create** (Loads → New load): load number, carrier, driver name and mobile, pickup and delivery (address search or typed `lat, lon`, pin can be dragged), arrival area (250 m–5 km) and optional appointments.
2. **Invite**: the driver link (`/d#token`) is shown once, with **Send by WhatsApp**, **Send by text message** (opens the broker's own Messages app), **Share…** and **Copy**; the driver's number and the invite text are filled in. With Twilio configured the link can also be texted automatically (with "Reply STOP"); that needs the broker to tick that the driver agreed to receive a text, which is recorded on the load's timeline and in the audit log. **Driver link** on the load page makes a new one (the old stops working; an accepted driver keeps their consent).
3. **Driver** opens the link, sees who asks and for which load, taps **Share my location** (consent time and browser are recorded) or **Decline**. While the page is open it sends a position every 2 minutes (queued on the phone when offline) and can **Stop sharing** / **Resume** at any time.
4. **Status** moves forward automatically: Waiting for driver → Heading to pickup → At pickup → In transit → At delivery → Delivered (leaving the delivery area). Exits need 1.2× the radius (no flapping); fixes worse than 500 m accuracy don't change status. The broker can **Mark delivered** or **Cancel**.
5. **ETA**: straight line × 1.3 at 80 km/h to the next stop; late when more than 15 minutes after the appointment. Labelled as an estimate.
6. **Shipper link** (`/track#token`): status, ETA, appointments and last position only — never driver name, phone, carrier or notes. Making a new one turns the old off.

## Loads map

**Loads → Map view** (`/loads/map`) shows every active load on one map, refreshed every 20 seconds:

- Dot colour = what the load is doing: **Moving** (fresh position at 5 mph / 8 km/h or more), **Stopped**, **Driver paused**, **No signal** (no position for 30 min). A red ring marks **Needs attention** (late, no signal or paused). Nearby loads group into a counted bubble below zoom 7; a red-edged bubble contains a load that needs attention.
- Side panel (bottom sheet on phones): filter chips with counts (All, Moving, Stopped, Needs attention, Waiting for driver), search, and the list with problems first.
- Picking a load shows its pickup/delivery pins and arrival areas, the trail so far, a dashed line to the next stop, and a card with status, speed, ETA, distance remaining, last update, and Open load / Call driver.
- Loads waiting for the driver have no position yet: they are listed but not on the map.

## Tracking with your own RIO tracker

Choose **Track with → One of our vehicles** when the load is hauled by one of the organization's own vehicles with a RIO tracker. There is no driver link or consent step: tracking starts when the load is created, from the tracker's current position. Every new tracker position (GPS webhook) moves the status the same way phone positions do, and the load's trail is the vehicle's own track from creation to the end of the load. The vehicle can be changed while the load is active; how a load is tracked cannot.

## Alerts

Loads raise alerts in the normal Alerts list (no rule needed), named after the load ("Load L-123 …") and linking to the load page:

| Alert | When | Email | Phone push |
|---|---|---|---|
| Load late | ETA to the next stop is more than 15 min past its appointment; once per stop | yes | yes |
| Load: no location | Tracking (not paused) with no position for 30 min (counted from acceptance until the first one); again only after a new position | yes | yes |
| Load: driver paused | The driver tapped Stop sharing | yes | yes |
| Load arrived | Arrived at pickup or delivery | no | yes |
| Load delivered | Delivered automatically on leaving the delivery | no | yes |

Emails go to Org admins, Fleet managers and Dispatchers. Phones get them when their "loads" choice is on (default on). The late / no-signal check runs every minute on one server process (advisory lock), with the other schedulers.

## Rules

- Positions are accepted only between accepting and the load ending, while sharing is on, within 24 h and ±2 min of clock slack. Repeats are ignored (`load_pings` unique on load + time).
- Loads, timeline and positions belong to one organization; deleting a load deletes its positions.
- Tokens are 256-bit, stored as SHA-256, sent in the URL fragment and POST bodies (never in URLs sent to the server). Unknown/replaced tokens all return the same 404.
- Permissions: `loads.read` all roles; `loads.write` Org admin, Fleet manager, Dispatcher.
- Rate limits: public endpoints 120/min per address (positions 60/min), address search 30/min per user, invites 5/hour per load.

## Limits of the web driver page

A web page can't track in the background. Sending pauses when the phone locks or the page closes and resumes when the link is reopened; the page asks for the screen to stay on. Background tracking comes with driver mode in the RIO GPS app (phase 27), using the same `/api/driver/*` endpoints with `source: "app"`.

## Configuration

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (optional) — see `.env.example`.
- Caddy allows `geolocation` only on `/d` (`infra/Caddyfile`); every other page keeps it blocked.
- Address search uses OpenStreetMap Nominatim (1 request/second, cached 7 days in Redis), limited to US, Canada and Mexico.
