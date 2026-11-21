#!/usr/bin/env bash
# Assembles the install bundle (#133 P2, P3): what a shop's installer runs
# from. One script for the Release workflow (which zips it) and the Installer
# test (which runs it), so the bundle tested is the bundle shipped.
#
#   deploy/make-bundle.sh <version> <out-dir>
#
# The layout:
#   install.sh  install.ps1  install-mac.sh  kwtech  INSTALL.md
#   docker/   compose.yml  compose.mac.yml  Caddyfile.docker  README.md  .env.example (version filled in)
#   mac/      prepare-mac.sh
#   windows/  prepare-windows.ps1  install-print-agent.ps1  lib/  README.md
set -euo pipefail

VERSION=${1:?Say the version: make-bundle.sh <version> <out-dir>}
OUT=${2:?Say where: make-bundle.sh <version> <out-dir>}
HERE=$(cd "$(dirname "$0")" && pwd)

rm -rf "$OUT"
mkdir -p "$OUT/docker" "$OUT/windows" "$OUT/mac"
cp "$HERE/install.sh" "$HERE/install.ps1" "$HERE/install-mac.sh" "$HERE/kwtech" "$HERE/INSTALL.md" "$OUT/"
chmod 755 "$OUT/install.sh" "$OUT/install-mac.sh" "$OUT/kwtech"
cp "$HERE/docker/compose.yml" "$HERE/docker/compose.mac.yml" "$HERE/docker/Caddyfile.docker" "$HERE/docker/README.md" "$OUT/docker/"
# Apple Silicon Macs (#233).
cp "$HERE/mac/prepare-mac.sh" "$OUT/mac/"
chmod 755 "$OUT/mac/prepare-mac.sh"
# The version filled in: the bundle runs exactly the images it shipped with.
sed "s/^KWTECH_VERSION=\"\"$/KWTECH_VERSION=\"$VERSION\"/" "$HERE/docker/.env.example" > "$OUT/docker/.env.example"
grep -q "^KWTECH_VERSION=\"$VERSION\"$" "$OUT/docker/.env.example" || { echo 'KWTECH_VERSION was not filled in .env.example' >&2; exit 1; }
# The Windows scripts, without their tests.
cp -r "$HERE/windows/." "$OUT/windows/"
rm -rf "$OUT/windows/test"
echo "Bundle for $VERSION in $OUT"
