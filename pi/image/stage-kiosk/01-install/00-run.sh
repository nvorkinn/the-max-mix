#!/bin/bash -e
# Runs the kiosk playbook (ansible/local.yml, the single source of truth for the device) against the image. pi/image/prepare.sh
# copies the repository's ansible/, pi/wifi-panel/ and pi/kiosk-audio/ into files/repo first, because only this stage's
# directory is visible to pi-gen's build. kiosk_image_build=true makes the playbook enable services without starting
# anything.

if [ ! -f files/repo/ansible/local.yml ] || [ ! -d files/repo/pi/wifi-panel ] || [ ! -d files/repo/pi/kiosk-audio ]; then
  echo "files/repo is missing: run pi/image/prepare.sh before the build (the pi-image workflow does)." >&2
  exit 1
fi

rm -rf "${ROOTFS_DIR}/tmp/repo"
cp -a files/repo "${ROOTFS_DIR}/tmp/repo"
on_chroot <<EOF2
cd /tmp/repo
LC_ALL=C.UTF-8 ansible-playbook --connection local --inventory localhost, --extra-vars kiosk_image_build=true ansible/local.yml
EOF2
rm -rf "${ROOTFS_DIR}/tmp/repo"
