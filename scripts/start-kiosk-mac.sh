#!/usr/bin/env bash
# Development approximation of start-kiosk.sh for macOS: same Chromium flags, separate profile.
# It does not start the server (build the client, then run `npm start`: it serves client/dist) and cannot verify Widevine or touch on the Pi.
set -euo pipefail

if [[ $(uname -s) != Darwin ]]; then
  echo "This launcher is for macOS. On Raspberry Pi OS use scripts/start-kiosk.sh." >&2
  exit 1
fi

browser=${KIOSK_BROWSER:-}
if [[ -z $browser ]]; then
  for candidate in \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    if [[ -x $candidate ]]; then browser=$candidate; break; fi
  done
fi
if [[ -z $browser || ! -x $browser ]]; then
  echo "No Chromium or Google Chrome found in /Applications. Set KIOSK_BROWSER to its executable." >&2
  exit 1
fi

url=${KIOSK_URL:-http://127.0.0.1:3000}
profile=${KIOSK_PROFILE:-$HOME/Library/Application Support/the-max-mix/chromium-dev}
timeout=${KIOSK_STARTUP_TIMEOUT:-30}
if [[ ! $timeout =~ ^[1-9][0-9]*$ ]]; then
  echo "KIOSK_STARTUP_TIMEOUT must be a positive integer." >&2
  exit 1
fi
deadline=$((SECONDS + timeout))
until curl --fail --silent --show-error --max-time 2 "${url%/}/api/health" >/dev/null; do
  if (( SECONDS >= deadline )); then
    echo "Server did not become ready at $url within $timeout seconds. Run 'npm start' first (after 'npm run build'; it serves the built client)." >&2
    exit 1
  fi
  sleep 1
done
mkdir -p "$profile"
chmod 700 "$profile"

# KIOSK_WINDOWED=true opens a 1024x600 window (the Waveshare resolution) instead of fullscreen kiosk.
if [[ ${KIOSK_WINDOWED:-} == true ]]; then
  mode=("--window-size=1024,600")
else
  mode=(--kiosk)
fi

exec "$browser" \
  "${mode[@]}" \
  --no-first-run \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  "--user-data-dir=$profile" \
  "$url"
