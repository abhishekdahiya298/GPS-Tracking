# Kingwo NT28E (trailer tracker) onboarding

The NT28E is a Kingwo IoT unit, not a Teltonika. It does not use port 5027,
FOTA WEB or the .cfg files. It is set up by SMS or with Kingwo's own tool.
Customers see it as **RIO GPS 28**.

First unit: IMEI `862601388000266`, trailer, SIM supplied by the seller and already fitted.

## 1. Server side (once)

Deploy this change. It opens two Traccar listeners:

| Port | Protocol | What the tracker sends as its ID |
|---|---|---|
| 5015 | JT808 (Traccar "huabao") | 12-digit terminal ID, often the last 12 digits of the IMEI |
| 5023 | GT06 | full 15-digit IMEI |
| **5095** | **Kingwo's own protocol (Traccar "upro") — factory default, use this first** | full 15-digit IMEI |

On the VPS, allow them in the firewall:

```
ufw allow 5015/tcp
ufw allow 5023/tcp
ufw allow 5095/tcp
```

Deploy does not restart Traccar. After a Traccar config change run, on the server:
`cd /opt/rio-gps && docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps traccar`

Check from outside the VPS: `nc -vz <vps-public-ip> 5015` and `... 5023`.

## 2. Tracker settings

Kingwo SMS commands (send to the SIM's phone number; the unit replies by SMS):

```
APN,<apn>#                       (APN,<apn>,<user>,<password># if needed)
IP,tracker.riogps.com,5095,1#    (1 = TCP)
*11*4#                           (check: replies IP, port, APN, terminal ID, version)
*22*4#                           (restart)
```

Settings:

- APN: the one for the seller's SIM (ask the seller; it is not `hologram`)
- Server: `tracker.riogps.com` (DNS only, not proxied through Cloudflare)
- Port: `5095` (Kingwo default protocol). `5015` (JT808) or `5023` (GT06) only if the seller switched the protocol.
- Report interval: trailer profile (for example every 5–10 min moving, a few times a day parked)

Also ask the seller for the SIM's phone number, ICCID and who pays for its data.

## 3. Find the ID it sends

On the VPS: `docker compose logs -f traccar | grep -E "huabao|gt06|Unknown device"`

Traccar logs `Unknown device - <id>` until the device is registered. Note that `<id>`.

## 4. Register in RIO

Platform console → Customers → customer → Bulk import (or Trackers → add to stock),
model **RIO GPS 28** (NT28E).

- If the ID from step 3 is the 15-digit IMEI (GT06): register the IMEI as usual.
- If it is a 12-digit ID (JT808): RIO registers the IMEI as Traccar's uniqueId,
  which will not match. Change the Traccar device's identifier to the 12-digit ID
  (Traccar admin UI over the SSH tunnel), and update `gps_devices.external_device_id`
  to the same value. RIO matches positions by `external_device_id`.

Then assign it to the trailer and add its SIM on the SIM cards page.
