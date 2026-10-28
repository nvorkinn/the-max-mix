#!/usr/bin/env bash
set -euo pipefail

session_variables=()
[[ -z ${DISPLAY:-} ]] || session_variables+=(DISPLAY)
[[ -z ${WAYLAND_DISPLAY:-} ]] || session_variables+=(WAYLAND_DISPLAY)
[[ -z ${XAUTHORITY:-} ]] || session_variables+=(XAUTHORITY)
[[ -z ${XDG_CURRENT_DESKTOP:-} ]] || session_variables+=(XDG_CURRENT_DESKTOP)
if (( ${#session_variables[@]} == 0 )); then
  echo "Start the kiosk session from the graphical desktop." >&2
  exit 1
fi
systemctl --user import-environment "${session_variables[@]}"
exec systemctl --user start the-max-mix-kiosk.service
