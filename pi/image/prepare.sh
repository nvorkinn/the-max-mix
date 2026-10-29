#!/usr/bin/env bash
# Copies pi/rootfs and pi/wifi-panel into the pi-gen stage, whose directory is the only one pi-gen's build can see. Run it
# from anywhere before building (the pi-image workflow does). The copies are ignored by Git.
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
files=$root/pi/image/stage-kiosk/01-install/files

for source in pi/rootfs pi/wifi-panel; do
  if [[ ! -d $root/$source ]]; then
    echo "$source is missing." >&2
    exit 1
  fi
done
for file in pi/wifi-panel/install.sh pi/wifi-panel/packages.txt; do
  if [[ ! -f $root/$file ]]; then
    echo "$file is missing: the image installs the Wi-Fi panel from pi/wifi-panel/." >&2
    exit 1
  fi
done

rm -rf "$files"
mkdir -p "$files"
cp -a "$root/pi/rootfs" "$files/rootfs"
cp -a "$root/pi/wifi-panel" "$files/wifi-panel"
