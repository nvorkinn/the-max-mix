#!/usr/bin/env bash
# Sets up THE MAX MIX on Raspberry Pi OS as a kiosk app: the prebuilt release is downloaded and served from the Pi itself
# (python3, loopback only), and Chromium opens it in fullscreen after desktop login. Nothing is built on the device and
# it needs no Node.js and no git.
# Usage: KIOSK_RELEASE_URL=https://<production address> bash install-kiosk.sh   (from a checkout, or fetched with curl from
#        GitHub, see the README). Run it again to update: it downloads the newest release and keeps the previous one for rollback.
# Environment: KIOSK_RELEASE_URL (required the first time; the https address of the production deployment, which serves
#              the release under /kiosk/. It is remembered in the settings file, so an update needs no variable),
#              KIOSK_REPO (default nvorkinn/the-max-mix, where the kiosk scripts are downloaded from),
#              KIOSK_PORT (the local port, default 4173, so the Spotify redirect URI is http://127.0.0.1:4173/),
#              KIOSK_URL (open another address instead of the local app; only https, or http://127.0.0.1 and
#              http://localhost, are accepted), KIOSK_INSTALL_DIR (default ~/.local/share/the-max-mix) and KIOSK_REF
#              (default main), which says where the kiosk scripts are downloaded from when this is not run from a checkout.
# The settings are kept in ~/.config/the-max-mix/kiosk.env. It is created on first install and left alone on a re-run,
# unless KIOSK_RELEASE_URL, KIOSK_PORT or KIOSK_URL is given again.
set -euo pipefail

default_port=4173
# Earlier installs opened a hosted site by default; a stored copy of that old default is replaced by the local app.
legacy_url=https://spotify.dev.nikolaivorkinn.com/

if [[ $(uname -s) != Linux || $(id -u) -eq 0 ]]; then
  echo "Run this installer on Raspberry Pi OS as the normal desktop user, not with sudo." >&2
  exit 1
fi
for dependency in curl systemctl sha256sum tar; do
  command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 1; }
done

valid_url() {
  # https anywhere, plain http only for this machine. No quotes, spaces, backslashes, dollars, backticks or percent signs,
  # so the value is safe in the env file, the systemd unit and the shell.
  local characters='[A-Za-z0-9._~:/?&=+,@-]'
  local pattern="^(https://${characters}+|http://(127\\.0\\.0\\.1|localhost)(:[0-9]{1,5})?(/${characters}*)?)\$"
  [[ $1 =~ $pattern ]]
}
valid_release_url() {
  # https only, no query, quotes, spaces, backslashes, dollars, backticks or percent signs: it is kept in the env file.
  [[ $1 =~ ^https://[A-Za-z0-9._~:/@-]+$ ]]
}
valid_port() {
  [[ $1 =~ ^[1-9][0-9]{3,4}$ ]] && (( $1 >= 1024 && $1 <= 65535 ))
}
stored() {
  # The last assignment wins (as in systemd); it may be quoted.
  sed -n "s/^$1=//p" "$config" | tail -n 1 | tr -d "\"'\r"
}

repo=${KIOSK_REPO:-nvorkinn/the-max-mix}
ref=${KIOSK_REF:-main}
if [[ ! $repo =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "KIOSK_REPO must look like owner/name." >&2
  exit 1
fi
if [[ ! $ref =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "KIOSK_REF may contain only letters, digits, dots, slashes, underscores and hyphens." >&2
  exit 1
fi
install=${KIOSK_INSTALL_DIR:-$HOME/.local/share/the-max-mix}
if [[ $install != /* || $install == *$'\n'* || $HOME == *$'\n'* ]]; then
  echo "The install directory must be an absolute path without newlines." >&2
  exit 1
fi
config_dir=$HOME/.config/the-max-mix
config=$config_dir/kiosk.env

# Decide the port and the address before anything is written. A custom address is optional: without one the kiosk opens
# http://127.0.0.1:<port>/.
port=$default_port
url=
release_url=
write_config=true
if [[ -f $config ]]; then
  write_config=false
  port=$(stored KIOSK_PORT)
  port=${port:-$default_port}
  url=$(stored KIOSK_URL)
  release_url=$(stored KIOSK_RELEASE_URL)
  if [[ $url == "$legacy_url" ]]; then
    url=
    write_config=true
  fi
fi
if [[ -n ${KIOSK_PORT:-} ]]; then
  port=$KIOSK_PORT
  write_config=true
fi
if [[ -n ${KIOSK_URL:-} ]]; then
  url=$KIOSK_URL
  write_config=true
fi
if [[ -n ${KIOSK_RELEASE_URL:-} ]]; then
  release_url=$KIOSK_RELEASE_URL
  write_config=true
fi
release_url=${release_url%/}
if [[ -z $release_url ]]; then
  echo "KIOSK_RELEASE_URL is required: the https address of the production deployment that serves the kiosk download" >&2
  echo "under /kiosk/, for example: KIOSK_RELEASE_URL=https://example.vercel.app bash install-kiosk.sh" >&2
  exit 1
fi
if ! valid_release_url "$release_url"; then
  echo "KIOSK_RELEASE_URL must be an https address without spaces, quotes or a query string, got: $release_url" >&2
  exit 1
fi
if ! valid_port "$port"; then
  echo "KIOSK_PORT must be a number from 1024 to 65535, got: $port" >&2
  exit 1
fi
if [[ -n $url ]] && ! valid_url "$url"; then
  echo "KIOSK_URL must be an https address (or http://127.0.0.1 or http://localhost) without spaces or quotes, got: $url" >&2
  exit 1
fi
open_url=${url:-http://127.0.0.1:$port/}

# Everything is downloaded and checked before the system is changed: the kiosk scripts (from this checkout, or from
# GitHub) and the release.
scripts=(start-kiosk.sh start-kiosk-session.sh serve-kiosk.sh the-max-mix-kiosk.service the-max-mix-server.service)
source_dir=
if [[ -n ${BASH_SOURCE[0]:-} ]]; then
  source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
fi
workdir=$(mktemp -d)
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT
for name in "${scripts[@]}"; do
  if [[ -n $source_dir && -f $source_dir/$name ]]; then
    cp "$source_dir/$name" "$workdir/$name"
  else
    echo "Downloading $name from $repo ($ref)..."
    curl --fail --silent --show-error --location --output "$workdir/$name" \
      "https://raw.githubusercontent.com/$repo/$ref/scripts/$name"
  fi
done

download() {
  curl --fail --silent --show-error --location --output "$workdir/$1" "$release_url/kiosk/$1"
}
echo "Downloading the latest release from $release_url..."
download latest-version
version=$(tr -d '\r\n' < "$workdir/latest-version")
if [[ ! $version =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "$release_url/kiosk/latest-version does not name a version; nothing was installed." >&2
  exit 1
fi
archive=the-max-mix-latest.tar.gz
download "$archive"
download "$archive.sha256"
(cd "$workdir" && sha256sum --check --status "$archive.sha256") || {
  echo "The checksum of $archive does not match $archive.sha256; nothing was installed." >&2
  exit 1
}
mkdir "$workdir/app"
tar -xzf "$workdir/$archive" -C "$workdir/app" --no-same-owner
if [[ ! -f $workdir/app/index.html ]]; then
  echo "$archive does not contain a built app (no index.html); nothing was installed." >&2
  exit 1
fi

sudo -v
sudo apt-get update
sudo apt-get install -y chromium curl python3

mkdir -p "$install/scripts" "$install/releases" "$config_dir"
for name in start-kiosk.sh start-kiosk-session.sh serve-kiosk.sh; do
  install -m 755 "$workdir/$name" "$install/scripts/$name"
done
for name in the-max-mix-kiosk.service the-max-mix-server.service; do
  install -m 644 "$workdir/$name" "$install/scripts/$name"
done

# Switch to the new release atomically: app is a symlink to releases/<version>, and the release it replaced stays as
# app.previous (for rollback, point the app symlink back at it and restart the server).
release=$install/releases/$version
rm -rf "$release.new"
mv "$workdir/app" "$release.new"
rm -rf "$release"
mv "$release.new" "$release"
previous=
[[ ! -L $install/app ]] || previous=$(readlink "$install/app")
ln -sfn "$release" "$install/app.next"
mv -T "$install/app.next" "$install/app"
if [[ -n $previous && $previous != "$release" ]]; then
  ln -sfn "$previous" "$install/app.previous"
fi
for old in "$install"/releases/*; do
  [[ $old == "$release" || $old == "$(readlink "$install/app.previous" 2>/dev/null || true)" ]] || rm -rf "$old"
done

if [[ $write_config == true ]]; then
  {
    printf '# THE MAX MIX kiosk settings. Change them, then: systemctl --user restart the-max-mix-server.service the-max-mix-kiosk.service\n'
    printf '# The app is served on this port of 127.0.0.1; register http://127.0.0.1:<port>/ as the Spotify redirect URI.\n'
    printf 'KIOSK_PORT=%s\n' "$port"
    printf '# Where the installer downloads releases from (re-run the installer to update).\nKIOSK_RELEASE_URL=%s\n' "$release_url"
    if [[ -n $url ]]; then
      printf '# Open this address instead of the local app.\nKIOSK_URL=%s\n' "$url"
    fi
  } > "$workdir/kiosk.env"
  install -m 600 "$workdir/kiosk.env" "$config"
fi
chmod 600 "$config"

# Bash 5.2 treats "&" in a replacement string specially; paths are substituted literally below.
shopt -u patsub_replacement 2>/dev/null || true
quote_unit() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  printf '%s' "${value//%/%%}"
}
root=$install
mkdir -p "$HOME/.config/systemd/user"
for name in the-max-mix-kiosk.service the-max-mix-server.service; do
  rendered=$(<"$install/scripts/$name")
  rendered=${rendered//@ROOT@/$(quote_unit "$root")}
  rendered=${rendered//@HOME@/$(quote_unit "$HOME")}
  rendered=${rendered//@ENV@/$(quote_unit "$config")}
  printf '%s\n' "$rendered" > "$workdir/rendered.service"
  install -m 644 "$workdir/rendered.service" "$HOME/.config/systemd/user/$name"
done

# Autostart entries run the session script, which starts the user service. labwc: a managed block that leaves the
# user's own entries alone. XDG: a desktop entry for desktops that use it.
session=$root/scripts/start-kiosk-session.sh
quote="'"
escaped_quote="'\\''"
mkdir -p "$HOME/.config/labwc" "$HOME/.config/autostart"
autostart=$HOME/.config/labwc/autostart
start_marker='# BEGIN THE MAX MIX KIOSK'
end_marker='# END THE MAX MIX KIOSK'
current=
if [[ -f $autostart ]]; then
  current=$(awk -v start="$start_marker" -v end="$end_marker" '
    $0 == start { skip = 1 }
    !skip { print }
    $0 == end { skip = 0 }
  ' "$autostart")
fi
{
  [[ -z $current ]] || printf '%s\n\n' "$current"
  printf '%s\n/bin/bash %s &\n%s\n' "$start_marker" "'${session//$quote/$escaped_quote}'" "$end_marker"
} > "$workdir/autostart"
cp "$workdir/autostart" "$autostart"
desktop_path=$(printf '%s' "$session" | sed -e 's/[\\`"$]/\\&/g' -e 's/%/%%/g')
printf '[Desktop Entry]\nType=Application\nName=THE MAX MIX kiosk\nExec=/bin/bash "%s"\nTerminal=false\n' "$desktop_path" \
  > "$HOME/.config/autostart/the-max-mix-kiosk.desktop"
systemctl --user daemon-reload

# Serve the new release now; the first install also starts the server on later logins.
systemctl --user enable the-max-mix-server.service
systemctl --user try-restart the-max-mix-server.service

echo "Installed THE MAX MIX $version. The kiosk will open $open_url after desktop login."
echo "Register this redirect URI in the Spotify dashboard (exact match, trailing slash included): ${url:-$open_url}"
echo "Enable Desktop Autologin and disable screen blanking in Raspberry Pi OS, then reboot."
echo "To update, run this installer again. To change the port or address, edit $config (or run this again with KIOSK_RELEASE_URL, KIOSK_PORT or KIOSK_URL set), then: systemctl --user restart the-max-mix-server.service the-max-mix-kiosk.service"
echo "Logs: journalctl --user -u the-max-mix-server.service -u the-max-mix-kiosk.service -f"
