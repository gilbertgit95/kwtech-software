#!/usr/bin/env bash
# Prepares an Apple Silicon (M-series) Mac to serve kwtech on the shop's
# network (#233): the Mac's counterpart of windows/prepare-windows.ps1.
#
#   bash mac/prepare-mac.sh             do it
#   bash mac/prepare-mac.sh --dry-run   say what it would do, change nothing
#
# Docker on the Mac is Colima (free; not Docker Desktop, whose licence #133
# avoids), installed with Homebrew. Every step checks first, so running it
# again is safe. Written for macOS's own bash 3.2.
#
# !! Tested on a real M-series Mac: not yet. The Installer CI cannot run
# Docker on a Mac. Try it on one before a shop relies on it.
set -euo pipefail

DRY=0
[ "${1:-}" = --dry-run ] && DRY=1
PLANNED=()

ok() { printf '  [ok] %s\n' "$1"; }
step() { printf '\n%s\n' "$1"; }
stop() { printf '  [xx] %s\n' "$1" >&2; exit 1; }
# change "what" command args...: runs it, or under --dry-run lists it.
change() {
  local what=$1
  shift
  if [ "$DRY" = 1 ]; then PLANNED+=("$what"); return 0; fi
  printf '  [..] %s\n' "$what"
  "$@"
}

COLIMA_CONFIG=$HOME/.colima/default/colima.yaml
# The VM Docker runs in: enough for the four containers, well inside an
# M-series Mac's memory. Changed later with `colima stop; colima start --cpu .. --memory ..`.
VM_ARGS=(--vm-type vz --cpu 4 --memory 6 --disk 60)

echo 'kwtech: preparing this Mac to serve the shop'
[ "$DRY" = 1 ] && echo '  (--dry-run: nothing will be changed)'

# --- 1. The Mac -----------------------------------------------------------------
step 'This Mac'
[ "$(uname -s)" = Darwin ] || stop 'This is for macOS. On Windows run install.ps1; on Linux install.sh.'
[ "$(uname -m)" = arm64 ] || stop 'Apple Silicon (M-series) Macs only. An Intel Mac is not supported.'
version=$(sw_vers -productVersion)
[ "${version%%.*}" -ge 13 ] || stop "macOS $version. macOS 13 (Ventura) or newer is needed for Colima's VM."
ok "macOS $version on Apple Silicon"
command -v brew >/dev/null 2>&1 || stop 'Homebrew is needed. Install it (brew.sh), open a new Terminal, and run this again.'
ok "Homebrew $(brew --version | head -n 1 | awk '{ print $2 }')"

# Ports 80 and 443: free, or already Colima's (a Mac set up before).
busy=''
for port in 80 443; do
  holders=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $1 }' | sort -u | grep -Ev '^(limactl|ssh|colima|com\.docke)' || true)
  [ -n "$holders" ] && busy="$busy port $port: $(echo "$holders" | tr '\n' ' ')"
done
[ -z "$busy" ] || stop "Ports 80 and 443 must be free for the app;$busy. Quit that program (another web server), then run this again."
ok 'Ports 80 and 443 are free (or already Colima'"'"'s)'

# --- 2. Docker: Colima, the Docker CLI and Compose ------------------------------
step 'Docker (Colima)'
for formula in colima docker docker-compose; do
  if brew list --formula "$formula" >/dev/null 2>&1; then
    ok "$formula installed"
  else
    change "Install $formula (Homebrew)" brew install "$formula"
  fi
done

# Homebrew's Compose is a Docker CLI plugin in Homebrew's folder: the CLI
# finds it only when ~/.docker/config.json lists that folder.
plugins="$(brew --prefix)/lib/docker/cli-plugins"
config=$HOME/.docker/config.json
if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose $(docker compose version --short)"
elif [ ! -f "$config" ]; then
  change "Tell Docker where Compose is ($config)" sh -c "mkdir -p '$HOME/.docker' && printf '{\n  \"cliPluginsExtraDirs\": [\"%s\"]\n}\n' '$plugins' > '$config'"
elif ! grep -q cliPluginsExtraDirs "$config"; then
  change "Tell Docker where Compose is ($config)" plutil -insert cliPluginsExtraDirs -json "[\"$plugins\"]" "$config"
else
  stop "Docker Compose is installed but the Docker CLI does not find it. Check cliPluginsExtraDirs in $config lists $plugins."
fi

# The VM. Its settings file appears on the first start; hostAddresses must be
# on so ports published on the Mac's network address reach phones
# (docker/compose.mac.yml). Without it they would reach this Mac only.
restart=0
if [ ! -f "$COLIMA_CONFIG" ]; then
  change 'Start Colima the first time (creates its VM: 4 CPUs, 6 GB, 60 GB)' colima start "${VM_ARGS[@]}"
fi
if [ -f "$COLIMA_CONFIG" ]; then
  if grep -Eq '^[[:space:]]*hostAddresses:[[:space:]]*true' "$COLIMA_CONFIG"; then
    ok 'Colima publishes ports on the Mac'"'"'s network address (hostAddresses)'
  elif grep -Eq '^[[:space:]]*hostAddresses:' "$COLIMA_CONFIG"; then
    change 'Turn on hostAddresses in Colima, so phones reach the published ports' \
      sed -i '' -E 's/^([[:space:]]*hostAddresses:)[[:space:]]*false/\1 true/' "$COLIMA_CONFIG"
    restart=1
  else
    stop "This Colima has no hostAddresses setting ($COLIMA_CONFIG). Update it: brew upgrade colima, then run this again."
  fi
elif [ "$DRY" = 1 ]; then
  PLANNED+=('Turn on hostAddresses in Colima, so phones reach the published ports')
fi
if [ "$restart" = 1 ]; then
  change 'Restart Colima so the setting applies (containers start again)' sh -c 'colima stop && colima start'
elif [ "$DRY" = 0 ] && ! colima status >/dev/null 2>&1; then
  change 'Start Colima' colima start
fi
[ "$DRY" = 1 ] || { docker info >/dev/null 2>&1 && ok "Docker Engine $(docker version --format '{{.Server.Version}}') in Colima"; }

# --- 3. Staying up ------------------------------------------------------------------
step 'Staying up'
# Colima runs as THIS user: it starts when they sign in (a LaunchAgent), so
# the Mac must sign in by itself after a power cut (INSTALL.md).
if brew services list 2>/dev/null | awk '$1 == "colima" { print $2 }' | grep -q started; then
  ok 'Colima starts when you sign in (brew services)'
else
  change 'Start Colima when you sign in (brew services start colima)' brew services start colima
fi
ac_sleep=$(pmset -g custom 2>/dev/null | awk '/AC Power/ { ac = 1 } ac && $1 == "sleep" { print $2; exit }')
if [ "${ac_sleep:-1}" = 0 ]; then
  ok 'Never sleeps on power'
else
  change 'Never sleep on power (asks for your password)' sudo pmset -c sleep 0 disksleep 0
fi

echo
if [ "$DRY" = 1 ]; then
  if [ "${#PLANNED[@]}" -eq 0 ]; then echo 'Nothing to change: this Mac is ready.'
  else echo 'Would change:'; for item in "${PLANNED[@]}"; do echo "  - $item"; done; fi
else
  echo 'This Mac is ready for the install.'
fi
