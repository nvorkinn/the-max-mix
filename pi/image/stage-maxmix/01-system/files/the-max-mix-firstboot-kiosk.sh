#!/usr/bin/env bash
# The first-boot screen, run by the user service the-max-mix-firstboot.service. It shows the Wi-Fi setup portal while the
# Pi has no internet and a progress page while the kiosk is being installed, then hands over to the installed kiosk
# (the-max-mix-kiosk.service, which conflicts with this service, so the two never run together).
set -euo pipefail

marker=/var/lib/the-max-mix/bootstrapped
status_file=/var/lib/the-max-mix/status.json
page=file:///opt/the-max-mix/firstboot/index.html
portal=http://127.0.0.1:8088/
profile=${XDG_CONFIG_HOME:-$HOME/.config}/the-max-mix/firstboot-chromium

if [[ $(id -u) -eq 0 ]]; then
  echo "Run the first-boot screen as the desktop user, not root." >&2
  exit 1
fi
if [[ -z ${WAYLAND_DISPLAY:-} && -z ${DISPLAY:-} ]]; then
  echo "No graphical session. Start the first-boot screen after desktop login." >&2
  exit 1
fi
browser=$(command -v chromium || command -v chromium-browser) || {
  echo "Chromium is missing." >&2
  exit 1
}
mkdir -p "$profile"
chmod 700 "$profile"

platform=wayland
[[ -n ${WAYLAND_DISPLAY:-} ]] || platform=x11

bootstrap_state() {
  sed -n 's/.*"state":"\([a-z_]*\)".*/\1/p' "$status_file" 2>/dev/null || true
}

# The portal only while the Pi is waiting for a network and the portal answers; the progress page otherwise.
wanted_page() {
  if [[ $(bootstrap_state) == waiting_for_network ]] && curl --silent --max-time 2 --output /dev/null "$portal"; then
    echo "$portal"
  else
    echo "$page"
  fi
}

pid=
stop_browser() {
  if [[ -n $pid ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    pid=
  fi
}
trap stop_browser EXIT

# --allow-file-access-from-files lets the local progress page read the status file. This browser only ever opens that
# page and the portal on this machine.
start_browser() {
  "$browser" \
    --kiosk \
    --no-first-run \
    --noerrdialogs \
    --disable-session-crashed-bubble \
    --overscroll-history-navigation=0 \
    --allow-file-access-from-files \
    "--ozone-platform=$platform" \
    "--user-data-dir=$profile" \
    "$1" &
  pid=$!
}

# The installed kiosk conflicts with this service: starting it stops this one, browser included. If it does not come up,
# restart the session once; the installed autostart then starts the kiosk on its own.
hand_over() {
  stop_browser
  systemctl --user daemon-reload
  if systemctl --user start the-max-mix-kiosk.service; then
    sleep 60
  fi
  local guard=${XDG_RUNTIME_DIR:-/tmp}/the-max-mix-handover-reboot
  if [[ ! -e $guard ]]; then
    touch "$guard"
    echo "The kiosk did not start; rebooting once." >&2
    systemctl reboot || sudo -n systemctl reboot
    sleep 60
  fi
  exit 1
}

current=
while true; do
  if [[ -e $marker || $(bootstrap_state) == "done" ]]; then
    hand_over
  fi
  want=$(wanted_page)
  if [[ $want != "$current" ]] || ! kill -0 "$pid" 2>/dev/null; then
    stop_browser
    start_browser "$want"
    current=$want
  fi
  sleep 2
done
