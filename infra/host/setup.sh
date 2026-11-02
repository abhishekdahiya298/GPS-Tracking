#!/usr/bin/env bash
# Host-level setup for the RIO GPS server. Safe to run again: every step checks
# first and only changes what is missing. Run as root:
#
#   bash /opt/rio-gps/infra/host/setup.sh
#
# 1. Docker daemon config (infra/docker/daemon.json): bounded logs and
#    live-restore, so a Docker engine upgrade or restart no longer stops the
#    containers. Applied with a reload (SIGHUP); running containers keep running.
# 2. 2 GB swap file and vm.swappiness=10: a safety net against the kernel's
#    out-of-memory killer, used only under memory pressure.
# 3. Nightly Traccar retention timer (infra/traccar/retention.sh, 04:30 UTC).
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
log() { echo "[setup] $*"; }

# 1. Docker daemon config
if ! cmp -s "$REPO/infra/docker/daemon.json" /etc/docker/daemon.json; then
  install -m 0644 "$REPO/infra/docker/daemon.json" /etc/docker/daemon.json
  systemctl reload docker
  log "docker daemon.json installed and reloaded"
else
  log "docker daemon.json already current"
fi
log "live-restore: $(docker info --format '{{.LiveRestoreEnabled}}')"

# 2. Swap
if [[ -z "$(swapon --show --noheadings)" ]]; then
  [[ -f /swapfile ]] || fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap -q /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  log "2 GB swap enabled"
else
  log "swap already enabled"
fi
echo 'vm.swappiness=10' >/etc/sysctl.d/99-rio-gps.conf
sysctl -q -p /etc/sysctl.d/99-rio-gps.conf

# 3. Traccar retention timer
for u in rio-gps-traccar-retention.service rio-gps-traccar-retention.timer; do
  install -m 0644 "$REPO/infra/traccar/$u" "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl enable --now rio-gps-traccar-retention.timer >/dev/null 2>&1
log "retention timer: $(systemctl list-timers rio-gps-traccar-retention.timer --no-pager --no-legend | awk '{print $1, $2, $3}')"
log "done"
