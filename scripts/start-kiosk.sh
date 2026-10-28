#!/usr/bin/env bash
set -euo pipefail

if [[ $(id -u) -eq 0 ]]; then
  echo "Run the kiosk as the desktop user, not root." >&2
  exit 1
fi
if [[ -z ${WAYLAND_DISPLAY:-} && -z ${DISPLAY:-} ]]; then
  echo "No graphical session. Start the kiosk after desktop login." >&2
  exit 1
fi
browser=$(command -v chromium || command -v chromium-browser) || {
  echo "Chromium is missing. Install the Raspberry Pi OS chromium package." >&2
  exit 1
}
url=${KIOSK_URL:-http://127.0.0.1:3000}
profile=${KIOSK_PROFILE:-${XDG_CONFIG_HOME:-$HOME/.config}/the-max-mix/chromium}
timeout=${KIOSK_STARTUP_TIMEOUT:-120}
if [[ ! $timeout =~ ^[1-9][0-9]*$ ]]; then
  echo "KIOSK_STARTUP_TIMEOUT must be a positive integer." >&2
  exit 1
fi
deadline=$((SECONDS + timeout))
until curl --fail --silent --show-error --max-time 2 "${url%/}/api/health" >/dev/null; do
  if (( SECONDS >= deadline )); then
    echo "Server did not become ready at $url within $timeout seconds." >&2
    exit 1
  fi
  sleep 1
done
mkdir -p "$profile"
chmod 700 "$profile"

platform=wayland
if [[ -z ${WAYLAND_DISPLAY:-} ]]; then
  platform=x11
  if command -v xset >/dev/null; then
    xset s off -dpms s noblank || echo "Could not disable X11 screen blanking; change it in the desktop settings." >&2
  fi
fi

exec "$browser" \
  --kiosk \
  --no-first-run \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  "--ozone-platform=$platform" \
  "--user-data-dir=$profile" \
  "$url"
