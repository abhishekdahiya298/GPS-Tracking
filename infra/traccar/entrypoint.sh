#!/bin/sh
# Traccar's env-var config-override mechanism (DATABASE_PASSWORD, FORWARD_HEADER,
# etc.) does not actually take effect in traccar/traccar:6.15.3-ubuntu — verified
# empirically: Hikari logs "no password was provided" / "password is an empty
# string" even with DATABASE_PASSWORD set. This script substitutes the two real
# secrets into the config template at container startup instead, so neither one
# ever needs to be hardcoded into the git-tracked traccar.xml.template.
set -eu

: "${TRACCAR_DB_PASSWORD:?TRACCAR_DB_PASSWORD must be set}"
: "${TRACCAR_WEBHOOK_SECRET:?TRACCAR_WEBHOOK_SECRET must be set}"

sed \
  -e "s|__TRACCAR_DB_PASSWORD__|${TRACCAR_DB_PASSWORD}|g" \
  -e "s|__TRACCAR_WEBHOOK_SECRET__|${TRACCAR_WEBHOOK_SECRET}|g" \
  /opt/traccar/conf/traccar.xml.template > /opt/traccar/conf/traccar.xml

exec /opt/traccar/jre/bin/java -XX:+ExitOnOutOfMemoryError -jar tracker-server.jar conf/traccar.xml
