# Loads (broker tracking)

A broker tracks a shipment through the driver's phone, with the driver's consent, from pickup to delivery.

## Flow

1. **Create** (Loads → New load): load number, carrier, driver name and mobile, pickup and delivery (address search or typed `lat, lon`, pin can be dragged), arrival area (250 m–5 km) and optional appointments.
2. **Invite**: the driver link (`/d#token`) is shown once. With Twilio configured it is also texted (with "Reply STOP"); otherwise the broker sends it. **Driver link** on the load page makes a new one (the old stops working; an accepted driver keeps their consent).
3. **Driver** opens the link, sees who asks and for which load, taps **Share my location** (consent time and browser are recorded) or **Decline**. While the page is open it sends a position every 2 minutes (queued on the phone when offline) and can **Stop sharing** / **Resume** at any time.
4. **Status** moves forward automatically: Waiting for driver → Heading to pickup → At pickup → In transit → At delivery → Delivered (leaving the delivery area). Exits need 1.2× the radius (no flapping); fixes worse than 500 m accuracy don't change status. The broker can **Mark delivered** or **Cancel**.
5. **ETA**: straight line × 1.3 at 80 km/h to the next stop; late when more than 15 minutes after the appointment. Labelled as an estimate.
6. **Shipper link** (`/track#token`): status, ETA, appointments and last position only — never driver name, phone, carrier or notes. Making a new one turns the old off.

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
