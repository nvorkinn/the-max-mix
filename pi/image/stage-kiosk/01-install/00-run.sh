#!/bin/bash -e
# Installs the kiosk: the Wi-Fi panel, the files from pi/rootfs, and the boot settings. pi/image/prepare.sh copies
# pi/rootfs and pi/wifi-panel into files/ first, because only this stage's directory is visible to pi-gen's build.
# Services are enabled, never started: nothing runs in the build chroot.

for dir in files/rootfs files/wifi-panel; do
  if [ ! -d "${dir}" ]; then
    echo "${dir} is missing: run pi/image/prepare.sh before the build (the pi-image workflow does)." >&2
    exit 1
  fi
done

# Wi-Fi panel: its packages (one per line, # comments allowed), then its own installer.
panel_packages="$(sed -e 's/#.*//' -e '/^[[:space:]]*$/d' files/wifi-panel/packages.txt | tr '\n' ' ')"
if [[ ! ${panel_packages} =~ ^[a-z0-9][a-z0-9.+:-]*( [a-z0-9][a-z0-9.+:-]*)*\ $ ]]; then
  echo "Unexpected contents in pi/wifi-panel/packages.txt: ${panel_packages}" >&2
  exit 1
fi
on_chroot <<EOF2
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${panel_packages}
EOF2
rm -rf "${ROOTFS_DIR}/tmp/wifi-panel"
cp -a files/wifi-panel "${ROOTFS_DIR}/tmp/wifi-panel"
on_chroot <<EOF2
bash /tmp/wifi-panel/install.sh
EOF2
rm -rf "${ROOTFS_DIR}/tmp/wifi-panel"
if [ ! -x "${ROOTFS_DIR}/usr/local/bin/wifi-panel" ]; then
  echo "pi/wifi-panel/install.sh did not install /usr/local/bin/wifi-panel." >&2
  exit 1
fi

# Systemd units, scripts, policies, the handler for kiosk-wifi:// links and the Plymouth theme.
cp -a files/rootfs/. "${ROOTFS_DIR}/"

# A cursor theme made of one transparent pixel, for touch screens that also look like a mouse.
le32() {
  printf '%b' "$(printf '\\x%02x\\x%02x\\x%02x\\x%02x' $(($1 & 255)) $((($1 >> 8) & 255)) $((($1 >> 16) & 255)) $((($1 >> 24) & 255)))"
}
cursors="${ROOTFS_DIR}/usr/share/icons/blank/cursors"
install -d -m 755 "${cursors}"
printf '[Icon Theme]\nName=blank\n' >"${ROOTFS_DIR}/usr/share/icons/blank/index.theme"
{
  printf 'Xcur'
  # header size, version, one table-of-contents entry
  le32 16 && le32 65536 && le32 1
  # entry: image chunk, nominal size 1, position 28
  le32 4294770690 && le32 1 && le32 28
  # chunk: header size, image type, nominal size, version, 1x1 pixels, hotspot 0,0, no delay, one transparent pixel
  le32 36 && le32 4294770690 && le32 1 && le32 1 && le32 1 && le32 1 && le32 0 && le32 0 && le32 0 && le32 0
} >"${cursors}/left_ptr"
for name in default arrow text xterm pointer hand1 hand2 grab grabbing crosshair wait watch progress not-allowed; do
  ln -sf left_ptr "${cursors}/${name}"
done

# Wi-Fi radios stay usable without a configured country only if the country is set; the pi-gen settings do that.
# No networks are configured and SSH stays off. pi-gen made the first user (kiosk) with a throwaway password: remove it
# and the sudo group, so nothing can log in.
on_chroot <<EOF2
usermod --pass='*' "${FIRST_USER_NAME}"
deluser "${FIRST_USER_NAME}" sudo
systemctl enable kiosk.service
systemctl mask getty@tty1.service
mkdir -p /etc/plymouth
printf '[Daemon]\nTheme=the-max-mix\nShowDelay=0\n' > /etc/plymouth/plymouthd.conf
update-initramfs -u -k all
EOF2

# Boot without text: console on tty3, quiet splash, no logo or cursor, and the 1024x600 screen forced on both HDMI ports
# (the firmware does not set a mode when disable_fw_kms_setup=1 is in config.txt).
cmdline="${ROOTFS_DIR}/boot/firmware/cmdline.txt"
sed -i -e 's/console=tty1/console=tty3/' \
  -e 's/$/ quiet splash plymouth.ignore-serial-consoles logo.nologo vt.global_cursor_default=0 loglevel=3 video=HDMI-A-1:1024x600@60 video=HDMI-A-2:1024x600@60/' "${cmdline}"
if ! grep -q 'console=tty3.* quiet splash ' "${cmdline}" || [ "$(wc -l <"${cmdline}")" -ne 1 ]; then
  echo "Unexpected cmdline.txt: $(cat "${cmdline}")" >&2
  exit 1
fi

# disable_splash hides the firmware's rainbow screen. The Pi 5 would boot a kernel with 16 KB memory pages; kernel8.img is
# the 4 KB-page kernel the Pi 4 already uses, which Widevine's module is built for.
cat >>"${ROOTFS_DIR}/boot/firmware/config.txt" <<'EOF2'

disable_splash=1

[pi5]
kernel=kernel8.img

[all]
EOF2
