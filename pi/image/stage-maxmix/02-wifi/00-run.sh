#!/bin/bash -e
# Installs the Wi-Fi setup portal (pi/wifi/install.sh). The pi-image workflow copies pi/wifi into files/wifi first, because
# only this stage's directory is visible to pi-gen's build container.
if [ ! -f files/wifi/install.sh ]; then
  echo "files/wifi/install.sh is missing: copy pi/wifi into $(pwd)/files/wifi before the build (the pi-image workflow does)." >&2
  exit 1
fi

rm -rf "${ROOTFS_DIR}/opt/the-max-mix/wifi-install"
mkdir -p "${ROOTFS_DIR}/opt/the-max-mix"
cp -a files/wifi "${ROOTFS_DIR}/opt/the-max-mix/wifi-install"

# install.sh runs as root inside the image (no running systemd), so it must enable its service, not start it.
on_chroot <<EOF2
cd /opt/the-max-mix/wifi-install
bash ./install.sh
EOF2
rm -rf "${ROOTFS_DIR}/opt/the-max-mix/wifi-install"

on_chroot <<EOF2
if ! systemctl is-enabled the-max-mix-wifi.service; then
  echo "pi/wifi/install.sh did not enable the-max-mix-wifi.service." >&2
  exit 1
fi
EOF2
