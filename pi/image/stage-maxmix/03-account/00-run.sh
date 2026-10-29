#!/bin/bash -e
# The desktop user, the first-run wizard and the desktop defaults.

# pi-gen insists on a password when the first-boot user rename is off, so the workflow passes a random throwaway one.
# Remove it again: nobody knows it, and the image must not carry any password. Use Raspberry Pi Imager's customisation
# (cloud-init) or an SSH key to get in; see pi/image/README.md.
on_chroot <<EOF2
usermod --pass='*' "${FIRST_USER_NAME}"
EOF2

# No "welcome" / new-user wizard: the user is already created and the kiosk needs no questions.
rm -f "${ROOTFS_DIR}/etc/xdg/autostart/piwiz.desktop"
rm -f "${ROOTFS_DIR}/etc/xdg/autostart/rpi-first-boot-wizard.desktop"
on_chroot <<EOF2
systemctl disable userconfig.service 2>/dev/null || true
systemctl disable first-boot-wizard.service 2>/dev/null || true
EOF2

# Desktop autologin and no screen blanking. The Ansible playbook applies the same settings again (once) on the Pi, so a
# failure here is only logged.
on_chroot <<EOF2
SUDO_USER="${FIRST_USER_NAME}" raspi-config nonint do_boot_behaviour B4 || echo "WARNING: could not enable desktop autologin at build time."
raspi-config nonint do_blanking 1 || echo "WARNING: could not turn off screen blanking at build time."
EOF2
