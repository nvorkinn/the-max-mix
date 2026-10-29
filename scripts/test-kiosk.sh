#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
bash -n "$root/scripts/start-kiosk.sh" "$root/scripts/install-kiosk.sh" "$root/scripts/start-kiosk-session.sh" "$root/scripts/start-kiosk-mac.sh" "$root/scripts/package-release.sh"
grep -Fq '"@ROOT@/scripts/serve.mjs"' "$root/scripts/the-max-mix.service"
grep -Fq 'EnvironmentFile="@ENV@"' "$root/scripts/the-max-mix.service"
grep -Eqx 'PORT=[0-9]+' "$root/scripts/kiosk.env.example"
if grep -Eq 'StateDirectory|server/' "$root/scripts/the-max-mix.service"; then
  echo "The service must not use a state directory or the removed server." >&2
  exit 1
fi
temporary=$(mktemp -d)
trap 'rm -f "$temporary/bin/id" "$temporary/bin/curl" "$temporary/bin/chromium" "$temporary/bin/xset" "$temporary/arguments" "$temporary/curl-count"; rmdir "$temporary/bin"; rmdir "$temporary/profile"; rmdir "$temporary"' EXIT
mkdir "$temporary/bin" "$temporary/profile"
export KIOSK_TEST_DIR="$temporary"
cat > "$temporary/bin/id" <<'STUB'
#!/usr/bin/env bash
echo 1000
STUB
cat > "$temporary/bin/curl" <<'STUB'
#!/usr/bin/env bash
count=0
[[ ! -f "$KIOSK_TEST_DIR/curl-count" ]] || read -r count < "$KIOSK_TEST_DIR/curl-count"
echo "$((count + 1))" > "$KIOSK_TEST_DIR/curl-count"
if [[ ${KIOSK_TEST_FAILURE:-} == true || $count == 0 ]]; then exit 22; fi
STUB
cat > "$temporary/bin/chromium" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$KIOSK_TEST_DIR/arguments"
STUB
cat > "$temporary/bin/xset" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$temporary/bin/id" "$temporary/bin/curl" "$temporary/bin/chromium" "$temporary/bin/xset"
export PATH="$temporary/bin:$PATH"
export KIOSK_PROFILE="$temporary/profile"
export KIOSK_STARTUP_TIMEOUT=3
export KIOSK_URL=http://127.0.0.1:3999
WAYLAND_DISPLAY=wayland-0 bash "$root/scripts/start-kiosk.sh"
grep -Fx -- '--ozone-platform=wayland' "$temporary/arguments"
grep -Fx -- "--user-data-dir=$temporary/profile" "$temporary/arguments"
grep -Fx -- 'http://127.0.0.1:3999' "$temporary/arguments"
if grep -q -- '--no-sandbox' "$temporary/arguments"; then exit 1; fi
WAYLAND_DISPLAY='' DISPLAY=:0 bash "$root/scripts/start-kiosk.sh"
grep -Fx -- '--ozone-platform=x11' "$temporary/arguments"
if WAYLAND_DISPLAY=wayland-0 KIOSK_TEST_FAILURE=true KIOSK_STARTUP_TIMEOUT=1 bash "$root/scripts/start-kiosk.sh"; then
  echo "Readiness failures must not launch the browser." >&2
  exit 1
fi
echo "Kiosk readiness, persistent profile, Wayland and X11 launch checks passed."
