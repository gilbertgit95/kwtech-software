#!/usr/bin/env bash
# Installs kwtech on this computer with Docker Compose (#133 P3), or brings an
# existing install up to date with this bundle's files. On Windows, run
# install.ps1 instead: it prepares Windows, then runs this inside WSL.
#
#   sudo ./install.sh                         a new install, asking a few questions
#   sudo ./install.sh --from-images FILE.tar  offline: the images from a USB stick
#
# Options (mostly for scripts and tests):
#   --dir DIR             where the install lives (default /opt/kwtech)
#   --address IP          this computer's address on the shop's network (default: detected, asked)
#   --version V           the release to run (default: the one this bundle came with)
#   --images PREFIX       where images come from (default: the project's public registry)
#   --http-port N --https-port N   ports to publish (default 80 and 443)
#   --no-pull             use images already on this computer
#
# Safe to run again: a setting already in .env is kept (never a new secret),
# first setup runs only on an install without an organization, and the shop's
# certificate authority stays in its volume.
set -euo pipefail

BUNDLE=$(cd "$(dirname "$0")" && pwd)
DIR=/opt/kwtech
ADDRESS=''
VERSION=''
IMAGES=''
HTTP_PORT=''
HTTPS_PORT=''
FROM_IMAGES=''
PULL=1

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR=$2; shift 2 ;;
    --address) ADDRESS=$2; shift 2 ;;
    --version) VERSION=$2; shift 2 ;;
    --images) IMAGES=$2; shift 2 ;;
    --http-port) HTTP_PORT=$2; shift 2 ;;
    --https-port) HTTPS_PORT=$2; shift 2 ;;
    --from-images) FROM_IMAGES=$2; shift 2 ;;
    --no-pull) PULL=0; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

ok() { printf '  [ok] %s\n' "$1"; }
step() { printf '\n%s\n' "$1"; }
stop() { printf '  [xx] %s\n' "$1" >&2; exit 1; }
# A person is typing only when standard input is a terminal; otherwise the
# answers are piped (the Windows wrapper, scripts, the CI test) and nothing
# is asked that has no answer waiting.
interactive() { [ -t 0 ]; }

ENV_FILE="$DIR/.env"
compose() { docker compose --project-directory "$DIR" -f "$DIR/compose.yml" --env-file "$ENV_FILE" "$@"; }
# !! Every Docker command but first setup reads from /dev/null: piped, the
# answers waiting on standard input are first setup's, and `compose exec`
# would otherwise swallow them.
quiet_compose() { compose "$@" < /dev/null; }

# The value of KEY in .env, or empty.
env_get() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" "$ENV_FILE" | tail -n 1; }
# Sets KEY in .env, replacing its line or adding one. Values are generated or
# checked here, never free text with quotes in it.
env_set() {
  if grep -q "^$1=" "$ENV_FILE"; then
    local tmp
    tmp=$(mktemp)
    awk -v key="$1" -v value="$2" 'BEGIN { FS = OFS = "=" } $1 == key { print key "=\"" value "\""; next } { print }' "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
  else
    printf '%s="%s"\n' "$1" "$2" >> "$ENV_FILE"
  fi
}
# Secrets from the kernel's random source, never printed, each in the form it
# must take: hex for the database password (it sits inside DATABASE_URL,
# where / + = break the URL), standard base64 for the rest, and the two-step
# key EXACTLY 32 bytes of it (the API refuses anything else).
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
b64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }

echo 'kwtech: installing on this computer'

# --- 1. Docker ----------------------------------------------------------------
step 'Docker'
command -v docker >/dev/null 2>&1 || stop 'Docker is not installed. On Windows run install.ps1, which installs it; on Linux install Docker Engine (docs.docker.com/engine/install).'
docker info >/dev/null 2>&1 || stop 'Docker is installed but not reachable from this user. Run this with sudo, or start Docker (sudo systemctl start docker).'
ok "Docker Engine $(docker version --format '{{.Server.Version}}')"
docker compose version >/dev/null 2>&1 || stop 'Docker Compose v2 is missing (docker compose). Install the docker-compose-plugin package from Docker'"'"'s repository, or docker-compose-v2 on Ubuntu.'
ok "Docker Compose $(docker compose version --short)"

# --- 2. The files ---------------------------------------------------------------
step "The install in $DIR"
[ -f "$BUNDLE/docker/compose.yml" ] || stop "This bundle has no docker/compose.yml beside install.sh ($BUNDLE)."
mkdir -p "$DIR"
# The bundle's files replace the install's: that is how an update brings new
# compose settings. .env is never one of them.
cp "$BUNDLE/docker/compose.yml" "$BUNDLE/docker/Caddyfile.docker" "$DIR/"
[ -f "$BUNDLE/docker/README.md" ] && cp "$BUNDLE/docker/README.md" "$DIR/"
if [ -f "$BUNDLE/kwtech" ]; then
  cp "$BUNDLE/kwtech" "$DIR/kwtech"
  chmod 755 "$DIR/kwtech"
  # The day-to-day command (status, logs, recover-account, ...), on the PATH when we may.
  if [ -w /usr/local/bin ]; then ln -sf "$DIR/kwtech" /usr/local/bin/kwtech; fi
fi
ok 'compose.yml and Caddyfile.docker in place'

# --- 3. Settings ----------------------------------------------------------------
step 'Settings'
if [ ! -f "$ENV_FILE" ]; then
  cp "$BUNDLE/docker/.env.example" "$ENV_FILE"
  ok 'a new .env from the bundle'
else
  ok '.env kept (only missing settings are filled in)'
fi
# Secrets inside: readable by the owner only.
chmod 600 "$ENV_FILE"

[ -n "$VERSION" ] && env_set KWTECH_VERSION "$VERSION"
[ -n "$(env_get KWTECH_VERSION)" ] || stop 'No version to run: this bundle'"'"'s .env.example has none. Pass --version.'
[ -n "$IMAGES" ] && env_set KWTECH_IMAGES "$IMAGES"
[ -n "$HTTP_PORT" ] && env_set KWTECH_HTTP_PORT "$HTTP_PORT"
[ -n "$HTTPS_PORT" ] && env_set KWTECH_HTTPS_PORT "$HTTPS_PORT"
ok "version $(env_get KWTECH_VERSION)"

# The address phones will use: the first one that is not Docker's own bridge.
detect_address() { hostname -I 2>/dev/null | tr ' ' '\n' | grep -Ev '^(172\.1[7-9]\.|127\.|$)' | grep -E '^[0-9.]+$' | head -n 1; }
if [ -n "$ADDRESS" ]; then
  env_set KWTECH_HTTPS_HOST "$ADDRESS"
elif [ -z "$(env_get KWTECH_HTTPS_HOST)" ]; then
  found=$(detect_address || true)
  if interactive; then
    read -r -p "  This computer's address on the shop's network [${found:-none found}]: " answer
    found=${answer:-$found}
  fi
  [ -n "$found" ] || stop 'No network address found. Connect this computer to the shop'"'"'s network, or pass --address.'
  env_set KWTECH_HTTPS_HOST "$found"
fi
ADDRESS=$(env_get KWTECH_HTTPS_HOST)
ok "address $ADDRESS"

generated=0
for spec in POSTGRES_PASSWORD:hex:24 AUTH_JWT_SECRET:b64:48 AUTH_MFA_SECRET_KEY:b64:32; do
  key=${spec%%:*}
  rest=${spec#*:}
  if [ -z "$(env_get "$key")" ]; then
    env_set "$key" "$("${rest%%:*}" "${rest#*:}")"
    generated=$((generated + 1))
  fi
done
# Never a new one over an existing secret: a new AUTH_JWT_SECRET signs
# everybody out, a new AUTH_MFA_SECRET_KEY makes every two-step sign-in
# unreadable, and a new POSTGRES_PASSWORD locks the app out of its data.
ok "secrets: $generated generated, $((3 - generated)) kept (never shown)"

if [ -z "$(env_get SMTP_URL)" ] && interactive && [ "$generated" -gt 0 ]; then
  read -r -p '  Email for password resets, as an SMTP URL (smtps://user:password@host:465), or Enter to skip: ' smtp
  if [ -n "$smtp" ]; then
    env_set SMTP_URL "$smtp"
    read -r -p '  The address emails come from (e.g. Shop <no-reply@shop.ph>): ' from
    [ -n "$from" ] && env_set MAIL_FROM "$from"
  fi
fi
if [ -n "$(env_get SMTP_URL)" ]; then ok 'email: on'; else ok 'email: off (a forgotten password is reset with: kwtech recover-account)'; fi

# --- 4. Images ------------------------------------------------------------------
step 'Images'
if [ -n "$FROM_IMAGES" ]; then
  [ -f "$FROM_IMAGES" ] || stop "No such file: $FROM_IMAGES"
  docker load -i "$FROM_IMAGES" < /dev/null >/dev/null
  ok "loaded from $FROM_IMAGES"
elif [ "$PULL" = 1 ]; then
  quiet_compose pull --quiet
  ok 'downloaded'
else
  ok 'using the images already on this computer'
fi

# --- 5. Start --------------------------------------------------------------------
step 'Starting the database, the app and HTTPS'
quiet_compose up -d --remove-orphans >/dev/null
# KWTECH_HEALTH_TIMEOUT: seconds to wait (default 6 minutes); shortened by tests.
for _ in $(seq 1 $(( ${KWTECH_HEALTH_TIMEOUT:-360} / 5 ))); do
  api=$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q api)" 2>/dev/null || echo starting)
  web=$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q web)" 2>/dev/null || echo starting)
  [ "$api" = healthy ] && [ "$web" = healthy ] && break
  sleep 5
done
if [ "$api" != healthy ] || [ "$web" != healthy ]; then
  for service in postgres api web caddy; do
    printf '\n--- %s, last lines ---\n' "$service" >&2
    quiet_compose logs --tail=25 "$service" >&2 || true
  done
  stop "Not healthy in time (api: $api, web: $web). The lines above say why. The shop's data is untouched; fix it and run this again."
fi
ok 'all healthy'

# Caddy makes the shop's certificate authority on its first HTTPS request;
# one now, so the certificate exists before the hand-off (and install.ps1
# can import it on this PC).
https_port=$(env_get KWTECH_HTTPS_PORT)
for _ in $(seq 1 24); do
  curl -sk -o /dev/null "https://127.0.0.1:${https_port:-443}/" < /dev/null 2>/dev/null || true
  quiet_compose exec -T caddy test -f /data/kwtech/pki/authorities/local/root.crt 2>/dev/null && break
  sleep 5
done
quiet_compose exec -T caddy test -f /data/kwtech/pki/authorities/local/root.crt 2>/dev/null \
  && ok "the shop's certificate authority exists" \
  || stop 'Caddy did not make the shop'"'"'s certificate. See: kwtech logs caddy'

# --- 6. First setup ---------------------------------------------------------------
step 'The shop and its first people'
organizations=$(quiet_compose exec -T postgres psql -U kwtech -d kwtech -tAc 'select count(*) from perm_organization' 2>/dev/null || echo 0)
if [ "${organizations:-0}" != 0 ]; then
  ok 'already set up (first setup is never run twice)'
elif interactive; then
  compose run --rm api first-setup
else
  # Piped: the answers wait on standard input, one per line (#206).
  compose run --rm -T api first-setup
fi

# --- 7. Hand-off -------------------------------------------------------------------
iface=$(ip -o -4 addr show 2>/dev/null | awk -v a="$ADDRESS" '{ split($4, p, "/"); if (p[1] == a) { print $2; exit } }')
mac=''
[ -n "$iface" ] && [ -r "/sys/class/net/$iface/address" ] && mac=$(cat "/sys/class/net/$iface/address")
url="https://$ADDRESS${https_port:+:$https_port}"
{
  echo "kwtech install record ($(date '+%Y-%m-%d'))"
  echo "  version   $(env_get KWTECH_VERSION)"
  echo "  computer  $(hostname)"
  echo "  address   $ADDRESS"
  echo "  MAC       ${mac:-unknown}"
  echo "  folder    $DIR"
} > "$DIR/RECORD.txt"

cat <<DONE

Done. kwtech runs at $url

Left to do by hand (INSTALL.md has each step):
  1. Reserve $ADDRESS on the router for this computer${mac:+ (MAC $mac)}, so phones keep finding it.
  2. On each phone, tablet and other PC: open the Local network page (Server, Local network),
     scan QR code 1 to install the shop's certificate, then QR code 2 to open the app.
  3. On each PC with a printer: install the print agent (install-print-agent.ps1) and pair it.

$DIR/RECORD.txt holds this install's details: keep a copy at the shop.
DONE
