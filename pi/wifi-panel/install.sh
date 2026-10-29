#!/usr/bin/env bash
# Install the THE MAX MIX Wi-Fi setup panel. Run as root, on a live Raspberry Pi or inside an image-build chroot.
# Idempotent. Needs no network: the packages in packages.txt must already be installed.
#   sudo pi/wifi-panel/install.sh
set -euo pipefail

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
target=/opt/the-max-mix/wifi-panel
launcher=/usr/local/bin/wifi-panel

if [[ $(id -u) -ne 0 ]]; then
  echo "Run this as root: sudo $0" >&2
  exit 1
fi
if ! python3 -c 'import PySide6.QtCore, PySide6.QtGui, PySide6.QtQml, PySide6.QtQuick' 2> /dev/null; then
  echo "PySide6 is missing. Install the packages in $source_dir/packages.txt first." >&2
  exit 1
fi

install -d -m 0755 "$target" "$target/qml"
for file in wifi_panel.py nmcli.py; do
  install -m 0644 "$source_dir/$file" "$target/$file"
done
for file in "$source_dir"/qml/*.qml; do
  install -m 0644 "$file" "$target/qml/$(basename "$file")"
done

cat > "$launcher" << 'LAUNCHER'
#!/bin/sh
exec /usr/bin/python3 /opt/the-max-mix/wifi-panel/wifi_panel.py "$@"
LAUNCHER
chmod 0755 "$launcher"
echo "Installed the Wi-Fi setup panel in $target (run $launcher)"
