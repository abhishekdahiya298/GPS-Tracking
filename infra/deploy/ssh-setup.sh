#!/usr/bin/env bash
# Used by .github/workflows/deploy.yml: writes the deploy key and the pinned
# server host key, and fails fast with a clear message if the key is damaged.
#
# DEPLOY_SSH_KEY may hold either the private key as-is (-----BEGIN ...) or the
# same key as ONE base64 line (base64 -w0 /root/rio-deploy-key), which survives
# copying from a web console that breaks or joins lines.
set -euo pipefail
: "${DEPLOY_SSH_KEY:?DEPLOY_SSH_KEY secret is empty}"
: "${DEPLOY_KNOWN_HOSTS:?}"
install -d -m 700 ~/.ssh
key=$(printf '%s' "$DEPLOY_SSH_KEY" | tr -d '\r')
if [[ "$key" != *"BEGIN OPENSSH PRIVATE KEY"* ]]; then
  key=$(printf '%s' "$key" | tr -d ' \n\t' | base64 -d 2>/dev/null) || {
    echo "::error::DEPLOY_SSH_KEY is neither a private key nor its base64 form. Recreate it: see docs/OPERATIONS.md"
    exit 1
  }
fi
# Rebuild the standard layout (header, 70-column body, footer), which also
# repairs a key whose line breaks were turned into spaces or lost.
body=${key#*-----BEGIN OPENSSH PRIVATE KEY-----}
body=${body%%-----END OPENSSH PRIVATE KEY-----*}
{
  echo "-----BEGIN OPENSSH PRIVATE KEY-----"
  printf '%s' "$body" | tr -d ' \n\t' | fold -w 70
  echo
  echo "-----END OPENSSH PRIVATE KEY-----"
} > ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519
if ! ssh-keygen -y -f ~/.ssh/id_ed25519 >/dev/null 2>&1; then
  echo "::error::DEPLOY_SSH_KEY is damaged (usually lost line breaks when copying). Store it as one line: base64 -w0 /root/rio-deploy-key"
  exit 1
fi
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > ~/.ssh/known_hosts
echo "deploy key OK"
