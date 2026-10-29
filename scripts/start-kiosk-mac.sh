#!/usr/bin/env bash
# Development approximation of start-kiosk.sh for macOS: same Chromium flags, separate profile.
# It opens KIOSK_URL (default: the hosted site). To try a local build instead, run `npm run build && npm start` and set
# KIOSK_URL to the vite preview address (http://127.0.0.1:4173/). It cannot verify Widevine or touch on the Pi.
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

url=${KIOSK_URL:-https://spotify.dev.nikolaivorkinn.com/}
profile=${KIOSK_PROFILE:-$HOME/Library/Application Support/the-max-mix/chromium-dev}
timeout=${KIOSK_STARTUP_TIMEOUT:-30}
if [[ ! $timeout =~ ^[1-9][0-9]*$ ]]; then
  echo "KIOSK_STARTUP_TIMEOUT must be a positive integer." >&2
  exit 1
fi
deadline=$((SECONDS + timeout))
until curl --fail --silent --show-error --location --max-time 5 --output /dev/null "$url"; do
  if (( SECONDS >= deadline )); then
    echo "$url did not answer within $timeout seconds. For a local build run 'npm run build && npm start' first." >&2
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
