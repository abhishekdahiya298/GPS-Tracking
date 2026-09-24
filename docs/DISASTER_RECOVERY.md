# RIO GPS: Backups and disaster recovery

PostgreSQL is the source of truth. It holds two databases:

- `rio`: organizations, users, devices, locations and history.
- `traccar`: Traccar's device registry and raw positions.

Redis is transient. Traccar configuration lives in git (`infra/traccar/`).
**A Docker volume is not a backup.**

## What runs

| Item | Where |
|---|---|
| Script | `infra/backup/pg-backup.sh` |
| Schedule | systemd timer `rio-gps-backup.timer`, daily 03:15 UTC ±10 min, `Persistent=true` |
| Local copies | `/var/backups/rio-gps/<UTC timestamp>/{rio,traccar}.dump[.gpg]` plus a `.sha256` for each, kept 14 days (`LOCAL_RETENTION_DAYS`) |
| Verification | Every dump is read back with `pg_restore --list` before it counts. A dump under 1 KB fails the run |
| Encryption | AES-256 (gpg symmetric), used when `/etc/rio-gps/backup.passphrase` exists (mode 600) |
| Off-site | DigitalOcean Spaces, used when `/etc/rio-gps/backup.env` exists (mode 600) |

The passphrase must also be stored **off the server**, for example in a password manager. Without it, the encrypted backups cannot be restored.

`/etc/rio-gps/backup.env` holds these keys; the values are never committed:

```
SPACES_ENDPOINT=https://<region>.digitaloceanspaces.com
SPACES_REGION=<region>
SPACES_BUCKET=<bucket>
SPACES_ACCESS_KEY_ID=<key>
SPACES_SECRET_ACCESS_KEY=<secret>
```

Use a Spaces key scoped to this one bucket. Enable a bucket lifecycle rule for off-site retention; 90 days is suggested.

## Install or update on the VPS

```bash
cd /opt/rio-gps
install -m 644 infra/backup/rio-gps-backup.service infra/backup/rio-gps-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now rio-gps-backup.timer
systemctl start rio-gps-backup.service       # run once now
journalctl -u rio-gps-backup.service -n 20   # expect backup.done
systemctl list-timers rio-gps-backup.timer
```

## Monitoring

```bash
systemctl status rio-gps-backup.service     # last run result
ls -1t /var/backups/rio-gps | head          # newest backup first
```

A failed run exits non-zero, and systemd records it as `failed`.

## Restore (tested procedure)

Always restore into a **scratch database first**, check it, and only then replace production.

```bash
cd /opt/rio-gps
B=/var/backups/rio-gps/<timestamp>

# 1. Decrypt (only if the dump is encrypted)
gpg --batch --pinentry-mode loopback --passphrase-file /etc/rio-gps/backup.passphrase \
    -d $B/rio.dump.gpg > /tmp/rio.dump
sha256sum -c $B/rio.dump.gpg.sha256          # run in $B before decrypting

# 2. Restore into a scratch database and inspect it
docker exec rio-gps-postgres-1 psql -U postgres -c "create database rio_restore_check"
docker exec -i rio-gps-postgres-1 pg_restore -U postgres -d rio_restore_check --no-owner < /tmp/rio.dump
docker exec rio-gps-postgres-1 psql -U postgres -d rio_restore_check -c "select count(*) from gps_devices"
```

3. **Replace production.** This is destructive, so stop and get approval first.
   - Stop the writers: `docker compose ... stop web worker traccar`.
   - Take a fresh backup of the current state.
   - Run `pg_restore --clean --if-exists -d rio`.
   - Start the services again.
   - Verify the device and the latest location.

To restore from off-site, first copy the dump down with the same aws-cli container used by the script (`s3 cp s3://<bucket>/rio-gps/<ts>/ ...`), then follow the steps above.

## Full server loss

1. Create a new Ubuntu 24.04 droplet and install Docker.
2. Clone the repo to `/opt/rio-gps`.
3. Recreate `.env` from the password manager. Never copy it from chat or logs.
4. `docker compose ... up -d postgres redis`.
5. Restore `rio` and `traccar` as above.
6. `docker compose ... up -d`.
7. Point the DNS A records for `gps` and `tracker` to the new IP (DNS only, not proxied).
8. Devices reconnect to `tracker.riocaliforniainc.com:5027` on their own once DNS updates.

## Targets

- **RPO:** 24 h with nightly dumps. Tighten later with WAL archiving if the business needs it.
- **RTO:** about 1 h for a full rebuild from this document.
