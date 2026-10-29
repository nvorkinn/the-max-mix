#!/usr/bin/env bash
# Started from the desktop session's autostart: runs the first-boot screen as a user service until THE MAX MIX has been
# installed. Once /var/lib/the-max-mix/bootstrapped exists it does nothing and the installed kiosk takes over.
set -euo pipefail

if [[ -e /var/lib/the-max-mix/bootstrapped ]]; then
  exit 0
fi

session_variables=()
[[ -z ${DISPLAY:-} ]] || session_variables+=(DISPLAY)
[[ -z ${WAYLAND_DISPLAY:-} ]] || session_variables+=(WAYLAND_DISPLAY)
[[ -z ${XAUTHORITY:-} ]] || session_variables+=(XAUTHORITY)
[[ -z ${XDG_CURRENT_DESKTOP:-} ]] || session_variables+=(XDG_CURRENT_DESKTOP)
if ((${#session_variables[@]} == 0)); then
  echo "Start the first-boot screen from the graphical desktop." >&2
  exit 1
fi
systemctl --user import-environment "${session_variables[@]}"
exec systemctl --user start the-max-mix-firstboot.service
