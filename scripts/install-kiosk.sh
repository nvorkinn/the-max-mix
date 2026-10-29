#!/usr/bin/env bash
# Sets up the THE MAX MIX kiosk on Raspberry Pi OS: Chromium opens the hosted site in fullscreen after desktop login.
# Nothing runs a server on the device and nothing is built there; the app is the hosted site.
# Usage: bash install-kiosk.sh        (from a checkout, or fetched with curl from GitHub, see the README)
# Environment: KIOSK_URL (the address to open; default https://spotify.dev.nikolaivorkinn.com/. Only https, or
#              http://127.0.0.1 and http://localhost for local testing, are accepted),
#              KIOSK_INSTALL_DIR (default ~/.local/share/the-max-mix), KIOSK_REPO (default nvorkinn/the-max-mix) and
#              KIOSK_REF (default main), which say where the kiosk scripts are downloaded from when this is not run from a checkout.
# The address is kept in ~/.config/the-max-mix/kiosk.env. It is created on first install and left alone on a re-run,
# unless KIOSK_URL is given again.
set -euo pipefail

default_url=https://spotify.dev.nikolaivorkinn.com/

if [[ $(uname -s) != Linux || $(id -u) -eq 0 ]]; then
  echo "Run this installer on Raspberry Pi OS as the normal desktop user, not with sudo." >&2
  exit 1
fi
for dependency in curl systemctl; do
  command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 1; }
done

valid_url() {
  # https anywhere, plain http only for this machine. No quotes, spaces, backslashes, dollars, backticks or percent signs,
  # so the value is safe in the env file, the systemd unit and the shell.
  local characters='[A-Za-z0-9._~:/?&=+,@-]'
  local pattern="^(https://${characters}+|http://(127\\.0\\.0\\.1|localhost)(:[0-9]{1,5})?(/${characters}*)?)\$"
  [[ $1 =~ $pattern ]]
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

# Decide the address before anything is written.
if [[ -n ${KIOSK_URL:-} ]]; then
  url=$KIOSK_URL
  write_config=true
elif [[ -f $config ]]; then
  # The last KIOSK_URL= line wins (as in systemd); it may be quoted.
  url=$(sed -n 's/^KIOSK_URL=//p' "$config" | tail -n 1 | tr -d "\"'\r")
  url=${url:-$default_url}
  write_config=false
else
  url=$default_url
  write_config=true
fi
if ! valid_url "$url"; then
  echo "KIOSK_URL must be an https address (or http://127.0.0.1 or http://localhost for testing) without spaces or quotes, got: $url" >&2
  exit 1
fi

# The scripts the kiosk runs are copied to the install directory, from this checkout or from GitHub.
scripts=(start-kiosk.sh start-kiosk-session.sh the-max-mix-kiosk.service)
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

sudo -v
sudo apt-get update
sudo apt-get install -y chromium curl

mkdir -p "$install/scripts" "$config_dir"
for name in start-kiosk.sh start-kiosk-session.sh; do
  install -m 755 "$workdir/$name" "$install/scripts/$name"
done
install -m 644 "$workdir/the-max-mix-kiosk.service" "$install/scripts/the-max-mix-kiosk.service"

if [[ $write_config == true ]]; then
  printf '# The address THE MAX MIX kiosk opens. Change it, then: systemctl --user restart the-max-mix-kiosk.service\nKIOSK_URL=%s\n' "$url" > "$workdir/kiosk.env"
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
unit=${workdir}/rendered.service
rendered=$(<"$install/scripts/the-max-mix-kiosk.service")
rendered=${rendered//@ROOT@/$(quote_unit "$root")}
rendered=${rendered//@HOME@/$(quote_unit "$HOME")}
rendered=${rendered//@ENV@/$(quote_unit "$config")}
printf '%s\n' "$rendered" > "$unit"
mkdir -p "$HOME/.config/systemd/user"
install -m 644 "$unit" "$HOME/.config/systemd/user/the-max-mix-kiosk.service"

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

echo "Installed. The kiosk will open $url after desktop login."
echo "Register that address as a redirect URI in the Spotify dashboard (exact match, trailing slash included)."
echo "Enable Desktop Autologin and disable screen blanking in Raspberry Pi OS, then reboot."
echo "To change the address, edit $config (or run this again with KIOSK_URL set), then: systemctl --user restart the-max-mix-kiosk.service"
echo "Kiosk logs: journalctl --user -u the-max-mix-kiosk.service -f"
