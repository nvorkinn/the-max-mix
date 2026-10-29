#!/bin/bash -e
# Copies THE MAX MIX's first-boot files into the image and writes /etc/the-max-mix/bootstrap.env.

# build.env is written by the pi-image workflow; the defaults here are for a hand-run pi-gen build.
build_env="${STAGE_DIR}/build.env"
build_value() {
  local value=""
  if [ -f "${build_env}" ]; then
    value="$(sed -n "s/^$1=//p" "${build_env}" | head -n 1)"
  fi
  echo "${value:-$2}"
}
kiosk_url="$(build_value KIOSK_URL https://the-max-mix.vercel.app/)"
playbook_repo="$(build_value PLAYBOOK_REPO https://github.com/nvorkinn/the-max-mix.git)"
playbook_ref="$(build_value PLAYBOOK_REF main)"

# These end up in a sed script and in an env file, so refuse anything unusual (the bootstrap checks them again).
url_pattern='^https://[A-Za-z0-9._~:/?&=+,@-]+$'
repo_pattern='^https://[A-Za-z0-9._~:/@-]+$'
ref_pattern='^[A-Za-z0-9][A-Za-z0-9._/-]*$'
[[ ${kiosk_url} =~ ${url_pattern} ]] || { echo "Invalid KIOSK_URL: ${kiosk_url}" >&2; exit 1; }
[[ ${playbook_repo} =~ ${repo_pattern} ]] || { echo "Invalid PLAYBOOK_REPO: ${playbook_repo}" >&2; exit 1; }
[[ ${playbook_ref} =~ ${ref_pattern} ]] || { echo "Invalid PLAYBOOK_REF: ${playbook_ref}" >&2; exit 1; }

install -d -m 755 "${ROOTFS_DIR}/opt/the-max-mix/bin" "${ROOTFS_DIR}/opt/the-max-mix/firstboot"
install -d -m 755 "${ROOTFS_DIR}/etc/the-max-mix" "${ROOTFS_DIR}/var/lib/the-max-mix"
install -d -m 755 "${ROOTFS_DIR}/etc/systemd/user/the-max-mix-kiosk.service.d" "${ROOTFS_DIR}/etc/xdg/autostart"

install -m 755 files/the-max-mix-bootstrap.sh "${ROOTFS_DIR}/opt/the-max-mix/bin/the-max-mix-bootstrap"
install -m 755 files/the-max-mix-firstboot-session.sh "${ROOTFS_DIR}/opt/the-max-mix/bin/the-max-mix-firstboot-session"
install -m 755 files/the-max-mix-firstboot-kiosk.sh "${ROOTFS_DIR}/opt/the-max-mix/bin/the-max-mix-firstboot-kiosk"
install -m 644 files/index.html "${ROOTFS_DIR}/opt/the-max-mix/firstboot/index.html"

install -m 644 files/the-max-mix-bootstrap.service "${ROOTFS_DIR}/etc/systemd/system/the-max-mix-bootstrap.service"
install -m 644 files/the-max-mix-firstboot.service "${ROOTFS_DIR}/etc/systemd/user/the-max-mix-firstboot.service"
install -m 644 files/10-firstboot.conf "${ROOTFS_DIR}/etc/systemd/user/the-max-mix-kiosk.service.d/10-firstboot.conf"
install -m 644 files/the-max-mix-firstboot.desktop "${ROOTFS_DIR}/etc/xdg/autostart/the-max-mix-firstboot.desktop"
install -D -m 755 files/90-the-max-mix-bootstrap.sh "${ROOTFS_DIR}/etc/NetworkManager/dispatcher.d/90-the-max-mix-bootstrap"

# "&" means "the match" in a sed replacement, so escape it.
sed -e "s|@KIOSK_URL@|${kiosk_url//&/\\&}|" \
  -e "s|@PLAYBOOK_REPO@|${playbook_repo}|" \
  -e "s|@PLAYBOOK_REF@|${playbook_ref}|" \
  files/bootstrap.env.in >"${ROOTFS_DIR}/etc/the-max-mix/bootstrap.env"
chmod 644 "${ROOTFS_DIR}/etc/the-max-mix/bootstrap.env"

# The desktop starts the first-boot screen through labwc's autostart (the XDG entry above covers other desktops). Once the
# playbook has run, the user's own ~/.config/labwc/autostart takes over and the script does nothing.
labwc_autostart="${ROOTFS_DIR}/etc/xdg/labwc/autostart"
mkdir -p "$(dirname "${labwc_autostart}")"
touch "${labwc_autostart}"
if ! grep -q the-max-mix-firstboot-session "${labwc_autostart}"; then
  # Make sure the previous line ends in a newline before appending.
  [ ! -s "${labwc_autostart}" ] || [ -z "$(tail -c 1 "${labwc_autostart}")" ] || echo >>"${labwc_autostart}"
  echo '/opt/the-max-mix/bin/the-max-mix-firstboot-session &' >>"${labwc_autostart}"
fi
