#!/usr/bin/env bash
# Runs the kiosk playbook the way the image build does (kiosk_image_build=true) in a plain Debian trixie container, then
# checks the main files and that the units are enabled but not started, and runs it a second time to check that nothing
# changes. CI starts it with: docker run --rm -v "$PWD:/repo:ro" debian:trixie bash /repo/ansible/tests/image-build.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8

# No kernel in a container, so packages must not try to build an initramfs.
mkdir -p /etc/initramfs-tools
echo update_initramfs=no > /etc/initramfs-tools/update-initramfs.conf

apt-get update --quiet
apt-get install --yes --quiet --no-install-recommends ansible-core ca-certificates git python3-apt systemd

# What Raspberry Pi OS and pi-gen provide before the playbook runs: the boot files and the kiosk user, with a password and
# in the sudo group.
mkdir -p /boot/firmware
echo 'console=serial0,115200 console=tty1 root=PARTUUID=00000000-02 rootfstype=ext4 fsck.repair=yes rootwait' > /boot/firmware/cmdline.txt
printf '# For more options and information see\n[all]\n' > /boot/firmware/config.txt
getent group sudo > /dev/null || groupadd sudo
useradd --create-home --shell /bin/bash --groups sudo kiosk
echo 'kiosk:throwaway' | chpasswd

cp -a /repo /work
cd /work

# The Raspberry Pi archive's packages are not in Debian, and there is no kernel to build an initramfs for.
play() {
  ansible-playbook --connection local --inventory localhost, ansible/local.yml \
    --extra-vars kiosk_image_build=true --extra-vars '{"kiosk_rpi_packages": [], "kiosk_update_initramfs": false}' | tee "$1"
}
play /tmp/first-run.log
play /tmp/second-run.log

fail=0
check() {
  if ! "$@"; then
    echo "FAILED: $*" >&2
    fail=1
  fi
}

for file in /usr/local/bin/kiosk-session /usr/local/bin/kiosk-open-wifi /usr/local/bin/wifi-panel \
  /usr/local/bin/kiosk-bluetooth-pair /etc/the-max-mix/bluetooth-devices /etc/systemd/system/kiosk-bluetooth-pair.service \
  /opt/the-max-mix/wifi-panel/wifi_panel.py /opt/the-max-mix/wifi-panel/qml/Main.qml \
  /etc/systemd/system/kiosk.service /etc/systemd/system/kiosk-pull.service /etc/systemd/system/kiosk-pull.timer \
  /etc/systemd/system/kiosk-restart.timer /etc/chromium/policies/managed/kiosk.json \
  /etc/polkit-1/rules.d/50-kiosk-networkmanager.rules /etc/NetworkManager/conf.d/20-connectivity.conf \
  /etc/tmpfiles.d/kiosk.conf /usr/share/plymouth/themes/the-max-mix/the-max-mix.plymouth \
  /usr/share/icons/blank/cursors/left_ptr /etc/apt/apt.conf.d/52kiosk-unattended-upgrades; do
  check test -e "$file"
done
for unit in kiosk.service kiosk-bluetooth-pair.service bluetooth.service kiosk-pull.timer kiosk-restart.timer; do
  check systemctl is-enabled --quiet "$unit"
  # Enabled only: nothing is started in an image build.
  if systemctl is-active --quiet "$unit"; then
    echo "FAILED: $unit is active" >&2
    fail=1
  fi
done
check grep -q '^DE:E3:A5:BE:A8:00 mouse$' /etc/the-max-mix/bluetooth-devices
check grep -q ' console=tty3 ' /boot/firmware/cmdline.txt
check grep -q 'video=HDMI-A-1:1024x600@60' /boot/firmware/cmdline.txt
check grep -q 'kernel=kernel8.img' /boot/firmware/config.txt
check test "$(grep -c 'THE MAX MIX KIOSK' /boot/firmware/config.txt)" -eq 2
check test "$(wc -l < /boot/firmware/cmdline.txt)" -eq 1
check test "$(getent shadow kiosk | cut -d: -f2)" = '*'
if id -nG kiosk | grep -qw sudo; then
  echo "FAILED: kiosk is still in the sudo group" >&2
  fail=1
fi
check grep -q 'ansible-pull --url https://github.com/nvorkinn/the-max-mix.git --checkout stable ' /etc/systemd/system/kiosk-pull.service
check grep -q 'en_GB.UTF-8' /etc/default/locale
check test "$(cat /etc/timezone)" = Europe/London

# The second run must not change anything.
if ! grep -Eq 'changed=0 ' /tmp/second-run.log; then
  echo "FAILED: the second run changed something" >&2
  fail=1
fi

exit "$fail"
