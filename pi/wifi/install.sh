#!/usr/bin/env bash
# Install the THE MAX MIX Wi-Fi setup portal. Run as root, on a live Raspberry Pi or inside an image-build chroot.
# Idempotent. Needs no network except, when dnsmasq-base is missing, to install it with apt.
#   sudo pi/wifi/install.sh
set -euo pipefail

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
target=/opt/the-max-mix/wifi
unit=the-max-mix-wifi.service
dnsmasq_dir=/etc/NetworkManager/dnsmasq-shared.d

if [[ $(id -u) -ne 0 ]]; then
  echo "Run this as root: sudo $0" >&2
  exit 1
fi
for tool in python3 nmcli; do
  if ! command -v "$tool" > /dev/null; then
    echo "$tool is required (Raspberry Pi OS Desktop ships both)." >&2
    exit 1
  fi
done

# NetworkManager's shared mode (the setup hotspot's DHCP and DNS) runs the dnsmasq binary from dnsmasq-base. Do not
# install the full dnsmasq package instead: its service would take port 53 away from NetworkManager's own copy.
if ! command -v dnsmasq > /dev/null; then
  echo "Installing dnsmasq-base (NetworkManager's hotspot needs it)"
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends dnsmasq-base
fi

install -d -m 0755 "$target"
for file in portal.py app.py controller.py logic.py nm.py page.py qrcodegen.py; do
  install -m 0644 "$source_dir/$file" "$target/$file"
done

install -d -m 0755 "$dnsmasq_dir"
install -m 0644 "$source_dir/dnsmasq-captive.conf" "$dnsmasq_dir/the-max-mix-captive.conf"

install -m 0644 "$source_dir/$unit" "/etc/systemd/system/$unit"
systemctl enable "$unit"
# Only a running systemd can be told to reload or restart; in an image-build chroot the enable above is enough.
if [[ -d /run/systemd/system ]]; then
  systemctl daemon-reload
  systemctl restart "$unit"
fi
echo "Installed the Wi-Fi setup portal in $target (service $unit, http://127.0.0.1:8088/)"
