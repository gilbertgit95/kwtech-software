#!/usr/bin/env bash
# The release check (#213, #133 P1): builds the images, boots them on an
# EMPTY database exactly as a shop runs them, checks they answer, runs first
# setup, and removes everything it made. Run before a release; #133 P2 runs it
# in CI.
#
#   deploy/docker/check-release.sh              build, then check
#   deploy/docker/check-release.sh --no-build   check images already built
#
# Its own Compose project (kwtech-check), its own volumes, and spare ports
# (18080, 18443), so it never touches a real install or a running dev setup
# on this machine. Secrets are generated for the run and thrown away.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/deploy/docker"
PROJECT=kwtech-check
TAG=${KWTECH_CHECK_TAG:-check}
HTTP_PORT=${KWTECH_CHECK_HTTP_PORT:-18080}
HTTPS_PORT=${KWTECH_CHECK_HTTPS_PORT:-18443}
# 127.0.0.1, not localhost: the Caddyfile serves localhost already, and the
# same name twice is a Caddy error.
HOST=127.0.0.1
BASE="https://$HOST:$HTTPS_PORT"

if [ "${1:-}" != "--no-build" ]; then
  echo "== building the images (kwtech-api:$TAG, kwtech-web:$TAG)"
  docker build -f "$HERE/api.Dockerfile" -t "kwtech-api:$TAG" "$ROOT"
  docker build -f "$HERE/web.Dockerfile" -t "kwtech-web:$TAG" "$ROOT"
fi

WORK=$(mktemp -d)
ENV_FILE="$WORK/.env"
# Each secret in the form it must take (the same as install.sh): the
# two-step key is EXACTLY 32 bytes of standard base64 (the API refuses
# anything else, which a stripped base64 broke: the first release's check
# caught it), and the database password is hex, since it sits inside
# DATABASE_URL, where / + = would break the URL.
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
b64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
cat > "$ENV_FILE" <<ENV
KWTECH_VERSION=$TAG
KWTECH_IMAGES=kwtech
KWTECH_HTTPS_HOST=$HOST
KWTECH_HTTP_PORT=$HTTP_PORT
KWTECH_HTTPS_PORT=$HTTPS_PORT
POSTGRES_PASSWORD=$(hex 24)
AUTH_JWT_SECRET=$(b64 48)
AUTH_MFA_SECRET_KEY=$(b64 32)
APP_NAME=kwtech release check
ENV

compose() { docker compose -p "$PROJECT" -f "$HERE/compose.yml" --env-file "$ENV_FILE" "$@"; }

cleanup() {
  echo "== removing the check's containers and volumes"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo "FAILED: $1" >&2
  compose ps >&2 || true
  compose logs --tail=40 >&2 || true
  exit 1
}

echo "== starting on an empty database"
# Not fatal by itself: `up` fails when a service is unhealthy, and the logs
# that say why are what the health wait below prints.
compose up -d || true

echo "== waiting for every service to be healthy"
for _ in $(seq 1 60); do
  api=$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q api)" 2>/dev/null || echo starting)
  web=$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q web)" 2>/dev/null || echo starting)
  [ "$api" = healthy ] && [ "$web" = healthy ] && break
  sleep 5
done
[ "$api" = healthy ] || fail "the API is not healthy ($api)"
[ "$web" = healthy ] || fail "the web app is not healthy ($web)"

check() {
  local name=$1 expected=$2 actual
  shift 2
  actual=$(curl -sk -o /dev/null -w '%{http_code}' "$@" || true)
  [ "$actual" = "$expected" ] || fail "$name: HTTP $actual, expected $expected"
  echo "  ok  $name ($actual)"
}

echo "== through Caddy, as a phone would"
check 'API health' 200 "$BASE/api/v1/health"
check 'sign-in page' 200 "$BASE/auth/signin"
answer=$(curl -sk "$BASE/api/v1/graphql" -H 'content-type: application/json' --data '{"query":"{ __typename }"}' || true)
echo "$answer" | grep -q '"__typename":"Query"' || fail "GraphQL answered: $answer"
echo "  ok  GraphQL answers"
check 'plain HTTP goes to HTTPS' 301 "http://$HOST:$HTTP_PORT/auth/signin"
# The authority exists once Caddy has made its first certificate (the requests above).
for _ in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://$HOST:$HTTP_PORT/kwtech-local-ca.crt" || true)
  [ "$code" = 200 ] && break
  sleep 5
done
check "the shop's certificate, for devices" 200 "http://$HOST:$HTTP_PORT/kwtech-local-ca.crt"

echo "== first setup, with piped answers"
PW='release check passphrase 1'
printf '%s\n' 'Check Shop' '' 'Counter' '' \
  'Check Admin' 'admin@check.test' '' "$PW" "$PW" \
  'Check Owner' 'owner@check.test' '' "$PW" "$PW" '' \
  'n' 'n' 'y' | compose run --rm -T api first-setup > "$WORK/setup.log" 2>&1 \
  || { cat "$WORK/setup.log" >&2; fail 'first setup'; }
grep -q 'is set up' "$WORK/setup.log" || { cat "$WORK/setup.log" >&2; fail 'first setup did not finish'; }
echo "  ok  first setup"
printf 'x\n' | compose run --rm -T api first-setup > "$WORK/again.log" 2>&1 && fail 'a second first setup was not refused'
grep -q 'first setup has been done' "$WORK/again.log" || { cat "$WORK/again.log" >&2; fail 'the second run refused for another reason'; }
echo "  ok  a second first setup is refused"

echo "== the API image holds no secret"
for path in /app/envs /app/.caddy /app/apps/web-server/.env.local /app/apps/web-app/e2e/billing/.fixture.json; do
  if compose run --rm -T --entrypoint sh api -c "test -e $path" >/dev/null 2>&1; then fail "$path is in the image"; fi
done
echo "  ok  no env profiles, .caddy or fixtures in the image"

echo
echo "Release check passed."
