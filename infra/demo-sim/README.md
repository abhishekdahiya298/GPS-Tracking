# Demo fleet simulator

A live-looking fleet for the **RIO GPS Demo** company: App Store / Play review
logins, store screenshots and sales demos. It pretends to be Teltonika
trackers — one TCP connection per unit to the tracker port (5027), IMEI login,
Codec 8 Extended records — so the data flows through Traccar, the webhook,
trips, alerts and reports exactly like a real FTM880/FTM164.

| Unit | IMEI | Behaviour |
|---|---|---|
| Demo Truck 101 | 359990000001015 | Brampton ON ⇄ Buffalo NY (QEW), 95 km/h |
| Demo Truck 102 | 359990000001023 | Buffalo NY ⇄ Cleveland OH (I-90), 100 km/h |
| Demo Truck 103 | 359990000001031 | Mississauga ON ⇄ London ON (401), 98 km/h |
| Demo Truck 104 | 359990000001049 | Detroit MI ⇄ Chicago IL (I-94), 102 km/h |
| Demo Truck 105 | 359990000001056 | Idling at a Buffalo truck stop (ignition on) |
| Demo Trailer 501 | 359990000001064 | Unhooked in the Brampton yard (no power) |
| Demo Trailer 502 | 359990000001072 | Hooked to Truck 101 (same route) |

The IMEIs are made-up numbers that pass the IMEI check digit. Register them
**only** in the demo customer (platform console → customer → Register tracker,
model FTM880). Unregistered IMEIs are refused by Traccar and the simulator just
retries every minute.

Driving units go A → B, rest 15 min with the ignition off, drive back, rest,
forever. Their place in the cycle comes from the clock, so a restart resumes
where each truck "should" be. Records every 30 s while moving, every 5 min while
idling, every 10 min while parked (a resting driving unit checks in every minute). Routes come from the public OSRM router the
first time and are cached in `/opt/rio-demo-sim/cache`.

## Run on the server

```bash
# Get the files without touching the /opt/rio-gps checkout (deploys fast-forward it):
B=origin/feat/demo-sim   # or origin/main once merged
cd /opt/rio-gps && git -c safe.directory=/opt/rio-gps fetch -q origin \
  && rm -rf /opt/rio-demo-sim/src && mkdir -p /opt/rio-demo-sim/src \
  && git -c safe.directory=/opt/rio-gps archive $B infra/demo-sim | tar -x -C /opt/rio-demo-sim/src
bash /opt/rio-demo-sim/src/infra/demo-sim/install.sh        # install/update + start
docker logs -f --tail 50 rio-demo-sim                       # watch (failures are always logged)
bash /opt/rio-demo-sim/src/infra/demo-sim/install.sh stop   # stop
```

Container `rio-demo-sim` (node:22-alpine, 128 MB / 0.25 CPU cap,
`--restart unless-stopped`, host network → 127.0.0.1:5027). It is not part of
docker compose and is untouched by deploys.

## Test locally

```bash
node --test infra/demo-sim/sim.test.mjs
node infra/demo-sim/sim.mjs --host 127.0.0.1 --port 5027 --once -v
```

The tests decode packets with an independent Codec 8E decoder and run the
simulator against a mock tracker server. It was also checked against a real
Traccar 6.15.3 (same version as production): all 7 units logged in and were
forwarded as valid positions with ignition, motion, power and odometer.
