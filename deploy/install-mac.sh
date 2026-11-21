#!/usr/bin/env bash
# Installs kwtech on an Apple Silicon (M-series) Mac (#233): the Mac's
# counterpart of install.ps1. One command, a few questions.
#
#   bash install-mac.sh             prepare the Mac, install, trust the certificate, check the network
#   bash install-mac.sh --dry-run   what preparing the Mac would change, and stop
#
# 1. mac/prepare-mac.sh: Colima (Docker), started at sign-in, no sleep.
# 2. install.sh: settings and secrets, images, start, first setup, in ~/kwtech.
# 3. This Mac trusts the shop's certificate (System keychain: asks your password).
# 4. Checks phones can reach the Mac's network address, and says so plainly.
#
# !! Tested on a real M-series Mac: not yet (#233). Run it on one before a shop relies on it.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DIR=$HOME/kwtech

if [ "${1:-}" = --dry-run ]; then
  bash "$HERE/mac/prepare-mac.sh" --dry-run
  echo
  echo '--dry-run: stopping before the install itself (install.sh).'
  exit 0
fi

bash "$HERE/mac/prepare-mac.sh"
bash "$HERE/install.sh" --dir "$DIR" "$@"

echo
echo "This Mac and the shop's certificate"
pem=$(mktemp)
trap 'rm -f "$pem"' EXIT
"$DIR/kwtech" certificate > "$pem"
fingerprint=$(openssl x509 -in "$pem" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':')
if security find-certificate -a -Z /Library/Keychains/System.keychain 2>/dev/null | grep -qi "SHA-256 hash: $fingerprint"; then
  echo '  [ok] This Mac already trusts it'
else
  echo '  [..] Trusting it on this Mac (System keychain; asks your password)'
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$pem"
fi

# Phones reach the Mac's network address; this Mac's own request to it is
# the closest check we have from here.
address=$("$DIR/kwtech" address)
echo
echo 'Can phones reach it?'
code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "https://$address/api/v1/health" || true)
if [ "$code" = 200 ]; then
  echo "  [ok] https://$address answers"
else
  cat >&2 <<WARN
  [xx] https://$address does not answer (got: ${code:-nothing}). This Mac works at https://localhost,
       but phones would not reach it. Check:
       - System Settings, Network, Firewall: allow incoming connections for limactl (Colima), or turn it off.
       - ~/.colima/default/colima.yaml has hostAddresses: true, then: colima stop; colima start
       - kwtech status, and kwtech logs caddy
WARN
fi

echo
echo 'Done. This Mac: https://localhost'
echo "Phones and other PCs: https://$address"
echo 'Left to do (INSTALL.md, "On a Mac"): reserve the address on the router, turn on automatic sign-in, register each device.'
open 'https://localhost' 2>/dev/null || true
