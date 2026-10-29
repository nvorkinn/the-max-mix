#!/usr/bin/env bash
# Serves the built app (the unpacked release) on the loopback address only, with Python's standard library: the Pi needs no Node.
# The app is a single page that uses query parameters (?demo=true), so no URL rewriting is needed.
set -euo pipefail

port=${KIOSK_PORT:-4173}
dir=${KIOSK_APP_DIR:?KIOSK_APP_DIR must point at the unpacked app}
if [[ ! $port =~ ^[1-9][0-9]{3,4}$ ]] || (( port < 1024 || port > 65535 )); then
  echo "KIOSK_PORT must be a number from 1024 to 65535, got: $port" >&2
  exit 1
fi
if [[ ! -f $dir/index.html ]]; then
  echo "No app found in $dir. Run install-kiosk.sh to download a release." >&2
  exit 1
fi
exec python3 -m http.server "$port" --bind 127.0.0.1 --directory "$dir"
