#!/usr/bin/env bash
# One-time (and after any change to infra/deploy/rio-deploy) server setup for
# the GitHub Actions deploy pipeline. Run as root on the server:
#
#   bash /opt/rio-gps/infra/deploy/install.sh
#
# 1. Installs infra/deploy/rio-deploy as /usr/local/sbin/rio-deploy. A fixed
#    copy is used so a deploy that updates the repo never edits the script
#    while it is running.
# 2. Creates the deploy key (first run only) and authorises it for that one
#    command: no shell, no port forwarding, no file access.
#    The private key is left in /root/rio-deploy-key for the owner to copy into
#    GitHub (secret DEPLOY_SSH_KEY), then delete with:  shred -u /root/rio-deploy-key
# 3. Prints the server's public host key line for the workflow's known_hosts.
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)

install -o root -g root -m 0755 "$SRC/rio-deploy" /usr/local/sbin/rio-deploy
install -d -o root -g root -m 0700 /var/lib/rio-deploy
echo "installed /usr/local/sbin/rio-deploy"

AUTH=/root/.ssh/authorized_keys
install -d -m 0700 /root/.ssh
touch "$AUTH" && chmod 600 "$AUTH"
if grep -q 'rio-deploy github-actions' "$AUTH"; then
  echo "deploy key already authorised"
else
  [[ -f /root/rio-deploy-key ]] || ssh-keygen -q -t ed25519 -N '' -C 'rio-deploy github-actions' -f /root/rio-deploy-key
  echo "command=\"/usr/local/sbin/rio-deploy\",restrict $(cat /root/rio-deploy-key.pub)" >>"$AUTH"
  rm -f /root/rio-deploy-key.pub
  echo "deploy key created and authorised (forced command only)"
  echo "NEXT: copy /root/rio-deploy-key into GitHub secret DEPLOY_SSH_KEY, then: shred -u /root/rio-deploy-key"
fi

echo "known_hosts line:"
echo "$(hostname -I | cut -d' ' -f1) $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
