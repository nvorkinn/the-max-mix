#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
bash -n "$root/scripts/start-kiosk.sh" "$root/scripts/start-kiosk-session.sh" "$root/scripts/start-kiosk-mac.sh"
unit="$root/ansible/roles/kiosk/templates/the-max-mix-kiosk.service.j2"
grep -Fq 'EnvironmentFile="{{ kiosk_config_dir' "$unit"
grep -Fq '/start-kiosk.sh"' "$unit"
if grep -Eq 'vercel|nikolaivorkinn|127\.0\.0\.1|serve' "$root/scripts/start-kiosk.sh" "$unit"; then
  echo "The kiosk must open the configured hosted address, with no built-in address and no local server." >&2
  exit 1
fi
temporary=$(mktemp -d)
trap 'rm -f "$temporary/bin/id" "$temporary/bin/curl" "$temporary/bin/chromium" "$temporary/bin/xset" "$temporary/arguments" "$temporary/curl-count" "$temporary/curl-urls"; rmdir "$temporary/bin"; rmdir "$temporary/profile"; rmdir "$temporary"' EXIT
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
echo "${*: -1}" >> "$KIOSK_TEST_DIR/curl-urls"
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
# Readiness is checked against the address itself.
grep -Fx -- 'http://127.0.0.1:3999' "$temporary/curl-urls"
if grep -q -- '--no-sandbox' "$temporary/arguments"; then exit 1; fi
# There is no built-in address: without KIOSK_URL nothing starts.
rm -f "$temporary/curl-count" "$temporary/arguments"
if env -u KIOSK_URL WAYLAND_DISPLAY=wayland-0 bash "$root/scripts/start-kiosk.sh" 2>/dev/null; then
  echo "A missing KIOSK_URL must not launch the browser." >&2
  exit 1
fi
if [[ -e "$temporary/arguments" ]]; then exit 1; fi
rm -f "$temporary/curl-count"
WAYLAND_DISPLAY='' DISPLAY=:0 bash "$root/scripts/start-kiosk.sh"
grep -Fx -- '--ozone-platform=x11' "$temporary/arguments"
if WAYLAND_DISPLAY=wayland-0 KIOSK_TEST_FAILURE=true KIOSK_STARTUP_TIMEOUT=1 bash "$root/scripts/start-kiosk.sh"; then
  echo "Readiness failures must not launch the browser." >&2
  exit 1
fi
echo "Kiosk required address, readiness, persistent profile, Wayland and X11 launch checks passed."
