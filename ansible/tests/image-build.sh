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
# No newline at the end, and Plymouth's words, as on a Pi where a package rewrote it.
printf '%s' 'console=serial0,115200 console=tty1 root=PARTUUID=00000000-02 rootfstype=ext4 fsck.repair=yes rootwait splash plymouth.ignore-serial-consoles' > /boot/firmware/cmdline.txt
printf '# For more options and information see\n[all]\n' > /boot/firmware/config.txt
getent group sudo > /dev/null || groupadd sudo
useradd --create-home --shell /bin/bash --groups sudo kiosk
echo 'kiosk:throwaway' | chpasswd

cp -a /repo /work
cd /work
# cp -a keeps the runner's owner, and git refuses to read a repository another user owns (the Pi's checkout is root's own).
git config --global --add safe.directory /work

# The Raspberry Pi archive's packages are not in Debian.
play() {
  ansible-playbook --connection local --inventory localhost, ansible/local.yml \
    --extra-vars kiosk_enable_only=true --extra-vars '{"kiosk_rpi_packages": []}' | tee "$1"
}
play /tmp/first-run.log
# A run skips each part of the setup whose files did not change, so the idempotency check below needs the first run's
# record of what it applied removed. The third run checks that skip, and the fourth that a part last run over a week ago
# runs again.
stamp=/var/lib/the-max-mix/applied.json
cp "$stamp" /tmp/applied.json
rm "$stamp"
play /tmp/second-run.log
play /tmp/third-run.log
node -e '
  const fs = require("node:fs");
  const stamp = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  stamp.system.at -= 8 * 86400;
  fs.writeFileSync(process.argv[1], JSON.stringify(stamp));
' "$stamp"
play /tmp/fourth-run.log

fail=0
check() {
  if ! "$@"; then
    echo "FAILED: $*" >&2
    fail=1
  fi
}

for file in /usr/local/bin/kiosk-session \
  /etc/systemd/system/kiosk.service /etc/systemd/system/kiosk-pull.service /etc/systemd/system/kiosk-pull.timer \
  /etc/systemd/system/kiosk-restart.timer /etc/chromium/policies/managed/kiosk.json \
  /etc/polkit-1/rules.d/50-kiosk-networkmanager.rules /etc/polkit-1/rules.d/50-kiosk-power.rules \
  /usr/local/sbin/kiosk-status /usr/local/bin/kiosk-display /usr/local/sbin/kiosk-ssh-keys \
  /usr/local/sbin/kiosk-app-switch \
  /etc/systemd/system/kiosk-ssh-keys.service /etc/systemd/system/kiosk-ssh-keys.timer \
  /etc/systemd/system/kiosk-widevine.path \
  /etc/systemd/system/kiosk-widevine.service \
  /etc/tmpfiles.d/kiosk.conf \
  /usr/share/icons/blank/cursors/left_ptr /etc/apt/apt.conf.d/52kiosk-unattended-upgrades \
  /opt/the-max-mix/kiosk-audio/node_modules/dbus-native/package.json \
  /opt/the-max-mix/kiosk-audio/node_modules/qrcode-generator/package.json \
  /etc/NetworkManager/dnsmasq-shared.d/50-kiosk-captive.conf /etc/sysctl.d/50-kiosk-unprivileged-ports.conf \
  /opt/the-max-mix/kiosk-audio/node_modules/ws/package.json /var/lib/the-max-mix/kiosk-audio-deps.sha1 \
  /etc/pipewire/pipewire.conf.d/50-kiosk-raop.conf /etc/systemd/user/default.target.wants/kiosk-audio.service; do
  check test -e "$file"
done
for unit in kiosk.service bluetooth.service avahi-daemon.service kiosk-pull.timer \
  kiosk-restart.timer kiosk-ssh-keys.timer ssh.service tailscaled.service kiosk-widevine.path; do
  check systemctl is-enabled --quiet "$unit"
  # Enabled only: nothing is started with kiosk_enable_only.
  if systemctl is-active --quiet "$unit"; then
    echo "FAILED: $unit is active" >&2
    fail=1
  fi
done
# Every source file of the service is installed, and no test or fixture.
for source in /work/pi/kiosk-audio/*.ts; do
  case $source in
    *.test.ts | */fixtures.ts) check test ! -e "/opt/the-max-mix/kiosk-audio/${source##*/}" ;;
    *) check test -e "/opt/the-max-mix/kiosk-audio/${source##*/}" ;;
  esac
done
check grep -q ' console=tty3 ' /boot/firmware/cmdline.txt
check grep -q 'video=HDMI-A-1:1024x600@60' /boot/firmware/cmdline.txt
check bash -c "! grep -Eq '(^| )(splash|plymouth\\.)' /boot/firmware/cmdline.txt"
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
# /etc/hosts names the machine's own host name (the container's here, the-max-mix-2 on a renamed Pi).
check grep -qx "127.0.1.1 $(cat /proc/sys/kernel/hostname)" /etc/hosts
check grep -q '^ExecStart=/usr/local/sbin/kiosk-pull https://github.com/nvorkinn/the-max-mix.git latest ' /etc/systemd/system/kiosk-pull.service
check test -x /usr/local/sbin/kiosk-pull
# Node runs the audio routing's TypeScript directly.
check node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'
# (node --check does not strip types, so load the modules instead; importing them starts nothing.)
check node -e "await import('/opt/the-max-mix/kiosk-audio/speakers.ts')"
check grep -q 'raop.latency.ms = 500' /etc/pipewire/pipewire.conf.d/50-kiosk-raop.conf
check grep -q 'kiosk-audio.ts watch$' /etc/systemd/user/kiosk-audio.service
check grep -q 'try-restart kiosk-audio.service' /etc/systemd/system/kiosk.service
check grep -q 'screen-mode.ts --correct' /etc/systemd/system/kiosk.service
check grep -q 'KIOSK_APP_ORIGIN=http://127.0.0.1:7341' /etc/systemd/user/kiosk-audio.service
check grep -q '"BrowserSignin": 0' /etc/chromium/policies/managed/kiosk.json
check grep -q '^Environment=KIOSK_SCREEN_OFF_AFTER=60$' /etc/systemd/system/kiosk.service
# No rotation by default: the output is left as it is, and touches are not turned.
check grep -q '^Environment=KIOSK_SCREEN_ROTATION=0$' /etc/systemd/system/kiosk.service
check grep -q '^Environment=KIOSK_SCREEN_SCALE=1.0$' /etc/systemd/system/kiosk.service
check grep -q '^Environment=KIOSK_SCREEN_SCALE=1.0$' /etc/systemd/user/kiosk-audio.service
check grep -q '^Environment=KIOSK_SCREEN_ROTATION=0$' /etc/systemd/user/kiosk-audio.service
check grep -q 'ENV{LIBINPUT_CALIBRATION_MATRIX}="1 0 0 0 1 0"$' /etc/udev/rules.d/90-kiosk-touch-rotation.rules
# The kiosk user, in the video group, may set a panel's backlight.
check grep -q 'chgrp video /sys/class/backlight/%k/brightness' /etc/udev/rules.d/90-kiosk-backlight.rules
check bash -c 'id -nG kiosk | grep -qw video'
check command -v swayidle wlr-randr
check grep -q 'en_GB.UTF-8' /etc/default/locale
check test "$(readlink /etc/localtime)" = /usr/share/zoneinfo/Europe/London
check grep -q '^Storage=persistent$' /etc/systemd/journald.conf.d/kiosk.conf
check grep -q '^SystemMaxUse=64M$' /etc/systemd/journald.conf.d/kiosk.conf

# The slow package step records that it is done, and the second run skips it.
# The progress lines the callback plugin prints after each task's header are left out.
# shellcheck disable=SC2329  # Called by check.
second_run_skips() {
  grep -v '^Ansible progress: ' /tmp/second-run.log | grep -A1 "TASK \\[kiosk : full | $1\\]" | grep -q '^skipping'
}
check test -s /var/lib/the-max-mix/packages.sha1
# The second run applied everything again and recorded the same ids as the first, for all five parts; the third found
# nothing to apply: only kiosk.service was looked at, nothing changed and no part ran. The fourth ran only the part whose
# last run was over a week ago.
# shellcheck disable=SC2329  # Called by check.
same_ids() {
  node -e '
    const fs = require("node:fs");
    const ids = file => Object.fromEntries(
      Object.entries(JSON.parse(fs.readFileSync(file, "utf8"))).map(([name, { id }]) => [name, id]));
    const [first, second] = process.argv.slice(1).map(ids);
    process.exit(Object.keys(first).length === 5 && JSON.stringify(first) === JSON.stringify(second) ? 0 : 1);
  ' "$@"
}
check same_ids /tmp/applied.json "$stamp"
check grep -q 'TASK \[kiosk : Install the kiosk service\]' /tmp/third-run.log
if grep -q 'TASK \[kiosk : full | ' /tmp/third-run.log; then
  echo "FAILED: the third run did not skip the parts" >&2
  fail=1
fi
check grep -Eq 'changed=0 ' /tmp/third-run.log
check grep -q 'TASK \[kiosk : full | system | Set the time zone\]' /tmp/fourth-run.log
if grep -q 'TASK \[kiosk : full | base | Install the packages' /tmp/fourth-run.log; then
  echo "FAILED: the fourth run ran a part that was not due" >&2
  fail=1
fi
check grep -Eq 'changed=0 ' /tmp/fourth-run.log
check second_run_skips 'base | Install the packages'
check second_run_skips "base | Install the other archives' packages"
check test -L /usr/share/icons/blank/cursors/not-allowed
check test -f /usr/share/kiosk-cursors/default/cursors/left_ptr

# The second run must not change anything.
if ! grep -Eq 'changed=0 ' /tmp/second-run.log; then
  echo "FAILED: the second run changed something" >&2
  fail=1
fi

exit "$fail"
