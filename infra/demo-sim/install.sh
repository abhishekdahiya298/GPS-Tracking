#!/usr/bin/env bash
# Install or update the RIO GPS demo fleet simulator on the production host.
# Runs as a small Node container next to the stack and talks to Traccar on
# 127.0.0.1:5027 like a real tracker would. Safe to re-run.
#
#   bash /opt/rio-gps/infra/demo-sim/install.sh            # install / update + start
#   bash /opt/rio-gps/infra/demo-sim/install.sh stop       # stop and remove
#   docker logs -f --tail 50 rio-demo-sim                  # watch it
set -euo pipefail

NAME=rio-demo-sim
DIR=/opt/rio-demo-sim
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE=node:22-alpine

if [[ "${1:-}" == "stop" ]]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  echo "demo-sim stopped"
  exit 0
fi

mkdir -p "$DIR/cache"
install -m 0644 "$SRC/sim.mjs" "$DIR/sim.mjs"
install -m 0644 "$SRC/units.json" "$DIR/units.json"

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" \
  --restart unless-stopped \
  --network host \
  --memory 128m --cpus 0.25 \
  --log-opt max-size=5m --log-opt max-file=2 \
  -v "$DIR:/app" -w /app \
  "$IMAGE" node sim.mjs --host 127.0.0.1 --port 5027 >/dev/null

sleep 8
docker logs --tail 30 "$NAME"
echo "demo-sim running (docker logs -f $NAME)"
