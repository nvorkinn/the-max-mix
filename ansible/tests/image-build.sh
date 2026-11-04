#!/usr/bin/env bash
# Runs the kiosk playbook with kiosk_enable_only=true (enable services, start nothing) in a plain Debian trixie container, then
# checks the main files and that the units are enabled but not started, and runs it a second time to check that nothing
# changes. CI starts it with: docker run --rm -v "$PWD:/repo:ro" debian:trixie bash /repo/ansible/tests/image-build.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8

# No kernel in a container, so packages must not try to build an initramfs.
mkdir -p /etc/initramfs-tools
echo update_initramfs=no > /etc/initramfs-tools/update-initramfs.conf

apt-get update --quiet
apt-get install --yes --quiet --no-install-recommends ansible-core ca-certificates git python3-apt systemd

# What Raspberry Pi OS and cloud-init provide before the playbook runs: the boot files and the kiosk user, with a password and
# in the sudo group.
mkdir -p /boot/firmware
echo 'console=serial0,115200 console=tty1 root=PARTUUID=00000000-02 rootfstype=ext4 fsck.repair=yes rootwait' > /boot/firmware/cmdline.txt
printf '# For more options and information see\n[all]\n' > /boot/firmware/config.txt
getent group sudo > /dev/null || groupadd sudo
useradd --create-home --shell /bin/bash --groups sudo kiosk
echo 'kiosk:throwaway' | chpasswd

cp -a /repo /work
cd /work
# cp -a keeps the runner's owner, and git refuses to read a repository another user owns (the Pi's checkout is root's own).
git config --global --add safe.directory /work

# The Raspberry Pi archive's packages are not in Debian, and there is no kernel to build an initramfs for.
play() {
  ansible-playbook --connection local --inventory localhost, ansible/local.yml \
    --extra-vars kiosk_enable_only=true --extra-vars '{"kiosk_rpi_packages": [], "kiosk_update_initramfs": false}' | tee "$1"
}
# A unit an earlier version of the playbook installed: a Pi that has it must lose it.
echo '[Unit]' > /etc/systemd/system/kiosk-update-now.service
play /tmp/first-run.log
# A run that finds nothing changed skips the slow part, so the idempotency check below needs the first run's record of what
# it applied removed. The third run checks that skip.
cp /var/lib/the-max-mix/applied.sha1 /tmp/applied.sha1
rm /var/lib/the-max-mix/applied.sha1
play /tmp/second-run.log
play /tmp/third-run.log

fail=0
check() {
  if ! "$@"; then
    echo "FAILED: $*" >&2
    fail=1
  fi
}

for file in /usr/local/bin/kiosk-session /usr/local/bin/wifi-panel \
  /usr/local/bin/kiosk-bluetooth-pair /etc/the-max-mix/bluetooth-devices /etc/systemd/system/kiosk-bluetooth-pair.service \
  /opt/the-max-mix/wifi-panel/wifi_panel.py /opt/the-max-mix/wifi-panel/qml/Main.qml \
  /etc/systemd/system/kiosk.service /etc/systemd/system/kiosk-pull.service /etc/systemd/system/kiosk-pull.timer \
  /etc/systemd/system/kiosk-restart.timer /etc/chromium/policies/managed/kiosk.json \
  /etc/polkit-1/rules.d/50-kiosk-networkmanager.rules /etc/polkit-1/rules.d/50-kiosk-power.rules \
  /usr/local/sbin/kiosk-handover /usr/local/bin/kiosk-display /usr/local/sbin/kiosk-ssh-keys \
  /etc/systemd/system/kiosk-ssh-keys.service /etc/systemd/system/kiosk-ssh-keys.timer \
  /etc/systemd/system/kiosk-widevine.path \
  /etc/systemd/system/kiosk-widevine.service /etc/NetworkManager/conf.d/20-connectivity.conf \
  /etc/tmpfiles.d/kiosk.conf /usr/share/plymouth/themes/the-max-mix/the-max-mix.plymouth \
  /usr/share/icons/blank/cursors/left_ptr /etc/apt/apt.conf.d/52kiosk-unattended-upgrades \
  /opt/the-max-mix/kiosk-audio/kiosk-audio.ts /opt/the-max-mix/kiosk-audio/speakers.ts \
  /opt/the-max-mix/kiosk-audio/server.ts /opt/the-max-mix/kiosk-audio/actions.ts \
  /opt/the-max-mix/kiosk-audio/update.ts /opt/the-max-mix/kiosk-audio/update-socket.ts \
  /opt/the-max-mix/kiosk-audio/node_modules/ws/package.json /var/lib/the-max-mix/kiosk-audio-deps.sha1 \
  /etc/pipewire/pipewire.conf.d/50-kiosk-raop.conf /etc/systemd/user/default.target.wants/kiosk-audio.service; do
  check test -e "$file"
done
for unit in kiosk.service kiosk-bluetooth-pair.service bluetooth.service avahi-daemon.service kiosk-pull.timer \
  kiosk-restart.timer kiosk-ssh-keys.timer ssh.service kiosk-widevine.path; do
  check systemctl is-enabled --quiet "$unit"
  # Enabled only: nothing is started with kiosk_enable_only.
  if systemctl is-active --quiet "$unit"; then
    echo "FAILED: $unit is active" >&2
    fail=1
  fi
done
check grep -q '^DE:E3:A5:BE:A8:00 mouse$' /etc/the-max-mix/bluetooth-devices
check grep -q '^D1:B9:E3:A0:7A:9D keyboard$' /etc/the-max-mix/bluetooth-devices
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
# The admin account: no password, sudo without one, SSH by key only.
check test "$(getent shadow admin | cut -d: -f2)" = '*'
check bash -c 'id -nG admin | grep -qw sudo'
check /usr/sbin/visudo -cf /etc/sudoers.d/50-kiosk-admin
check grep -q '^PasswordAuthentication no$' /etc/ssh/sshd_config.d/10-kiosk.conf
check grep -q '^AllowUsers admin$' /etc/ssh/sshd_config.d/10-kiosk.conf
mkdir -p /run/sshd
check /usr/sbin/sshd -t
check test "$(stat -c %a /home/admin/.ssh)" = 700
check grep -q '^127.0.1.1 the-max-mix$' /etc/hosts
check grep -q '^ExecStart=/usr/local/sbin/kiosk-pull https://github.com/nvorkinn/the-max-mix.git latest ' /etc/systemd/system/kiosk-pull.service
check test -x /usr/local/sbin/kiosk-pull
# Node runs the audio routing's TypeScript directly.
check node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'
# (node --check does not strip types, so load the modules instead; importing them starts nothing.)
check node -e "await import('/opt/the-max-mix/kiosk-audio/speakers.ts')"
check grep -q 'raop.latency.ms = 500' /etc/pipewire/pipewire.conf.d/50-kiosk-raop.conf
check grep -q 'kiosk-audio.ts watch$' /etc/systemd/user/kiosk-audio.service
check grep -q 'try-restart kiosk-audio.service' /etc/systemd/system/kiosk.service
check grep -q 'KIOSK_APP_ORIGIN=https://the-max-mix.vercel.app' /etc/systemd/user/kiosk-audio.service
check grep -q '"LocalNetworkAccessAllowedForUrls"' /etc/chromium/policies/managed/kiosk.json
check grep -q '^Environment=KIOSK_SCREEN_OFF_AFTER=60$' /etc/systemd/system/kiosk.service
check command -v swayidle wlr-randr
check grep -q 'en_GB.UTF-8' /etc/default/locale
check test "$(cat /etc/timezone)" = Europe/London
check grep -q '^Storage=persistent$' /etc/systemd/journald.conf.d/kiosk.conf
check grep -q '^SystemMaxUse=64M$' /etc/systemd/journald.conf.d/kiosk.conf

# The slow package step records that it is done, and the second run skips it. (The SSH keys download is not checked: it
# needs GitHub, which a test must not depend on.)
# shellcheck disable=SC2329  # Called by check.
second_run_skips() {
  grep -A1 "TASK \\[kiosk : $1\\]" /tmp/second-run.log | grep -q '^skipping'
}
check test -s /var/lib/the-max-mix/packages.sha1
# The second run applied everything again and recorded the same ids as the first; the third found nothing to apply: only
# kiosk.service was looked at, nothing changed and the slow tasks did not even run.
check test -s /var/lib/the-max-mix/applied.sha1
check cmp /tmp/applied.sha1 /var/lib/the-max-mix/applied.sha1
check grep -q 'TASK \[kiosk : Install the kiosk service\]' /tmp/third-run.log
if grep -q 'TASK \[kiosk : Install the packages' /tmp/third-run.log; then
  echo "FAILED: the third run did not skip the slow part" >&2
  fail=1
fi
check grep -Eq 'changed=0 ' /tmp/third-run.log
check second_run_skips 'Install the packages'
check second_run_skips 'Install Node.js'
check test -L /usr/share/icons/blank/cursors/not-allowed
check test -d /usr/share/plymouth/themes/the-max-mix
check test ! -e /etc/systemd/system/kiosk-update-now.service

# The second run must not change anything.
if ! grep -Eq 'changed=0 ' /tmp/second-run.log; then
  echo "FAILED: the second run changed something" >&2
  fail=1
fi

exit "$fail"
