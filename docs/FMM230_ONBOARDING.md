# Onboarding a Teltonika FMM230 (or any additional Teltonika device)

The FMM230 speaks the same Teltonika protocol as the FTM880. It uses the same Traccar port (`5027`) and the same ingest path. RIO needs no code changes.

This runbook follows the FTM880 bring-up (2026-09-23/24). Every value comes from the real device and SIM; nothing is guessed.

## 0. What you need

| Item | Where it comes from |
|---|---|
| IMEI (15 digits) | The label on the device, or the Teltonika Configurator "Status" tab |
| SIM APN, plus username/password if any | The SIM provider (Hologram: APN `hologram`, no auth) |
| An active SIM with data | The SIM provider's dashboard |
| **Permanent external power** | The vehicle's 12/24 V supply. Without external power the device does not send data (root cause #2 on the FTM880) |

## 1. Configure the device (Teltonika Configurator, USB)

The GPRS and server settings must match the FTM880's, which are verified working:

| Setting | Value |
|---|---|
| APN | as supplied by the SIM provider |
| Domain | `tracker.riocaliforniainc.com` |
| Port | `5027` |
| Protocol | TCP |
| Data protocol | **Codec 8 Extended** |
| Record saving | After time sync |
| AVL data acknowledgement | On |

Suggested data acquisition values:

- **Moving:** min period 300 s, min distance 100 m, angle 10°, speed delta 10 km/h, send period 120 s.
- **Idling:** min period 3600 s, send period 120 s. A parked vehicle then reports hourly, which is why the offline threshold is 3900 s. Lower this if you need more frequent parked updates.

Save the configuration to the device, then read it back to confirm.

## 2. Register the device in Traccar (by IMEI)

Traccar rejects unknown devices; it replies `00` and logs "Unknown device" (root cause #1 on the FTM880). Add the device in the Traccar admin through an SSH tunnel:

```bash
ssh -L 8082:localhost:8082 root@<vps>
# then open http://localhost:8082 → Devices → +
```

Set **Identifier = IMEI** and give it a name such as `FMM230-<last 4 of IMEI>`.

## 3. Register the device in RIO (by IMEI)

```bash
cd /opt/rio-gps
docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres \
  psql -U postgres -d rio -v ON_ERROR_STOP=1 \
  -v org_name='RIO California Inc' -v org_slug='rio-california' \
  -v imei='<IMEI>' -v model='FMM230' \
  -f - < infra/postgres/register-device.sql
```

This script is idempotent, so it is safe to re-run. To put the device in another customer's organization, pass that organization's name and slug.

## 4. Assign it to a vehicle

In RIO, go to **Vehicles**, add the vehicle if needed, then choose **Assign to…** next to the FMM230.

New history points are attributed to that vehicle from this moment on.

## 5. Verify end to end

| Check | How | Expected |
|---|---|---|
| TCP reaches Traccar | `docker logs --since 10m rio-gps-traccar-1 \| grep <IMEI>` | Connection lines, then `00000001` ACKs. No "Unknown device" |
| Traccar forwards to RIO | Same logs | No `HTTP code 4xx/5xx` forward errors |
| RIO stores it | `/api/admin/ops` (super admin), or the `ingest.stats` logs | `stored` count increases |
| Live map | `/map` | Device shows **online**, and the marker moves while driving |
| History | `/map` → device → **Show track** | Track appears |

If nothing arrives, check these in order:

1. External power. Use Configurator "Status" and confirm the power voltage is well above 12 V.
2. SIM data session and APN.
3. Traccar "Unknown device" (the IMEI isn't registered).
4. The Traccar forward error in the logs.
5. The RIO `ingest.unknown_device` warning (the IMEI isn't registered in RIO).

## Notes

- Never register placeholder IMEIs in Traccar or RIO.
- Firmware updates and device resets are out of scope for this runbook. Do them only deliberately.
