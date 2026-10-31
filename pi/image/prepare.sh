#!/usr/bin/env bash
# Copies ansible/, pi/wifi-panel/ and pi/kiosk-audio/ into the pi-gen stage, whose directory is the only one pi-gen's
# build can see. Run it from anywhere before building (the pi-image workflow does). The copy is ignored by Git.
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
repo=$root/pi/image/stage-kiosk/01-install/files/repo

for source in ansible pi/wifi-panel pi/kiosk-audio; do
  if [[ ! -d $root/$source ]]; then
    echo "$source is missing." >&2
    exit 1
  fi
done

rm -rf "$repo"
mkdir -p "$repo/pi"
cp -a "$root/ansible" "$repo/ansible"
cp -a "$root/pi/wifi-panel" "$repo/pi/wifi-panel"
cp -a "$root/pi/kiosk-audio" "$repo/pi/kiosk-audio"
