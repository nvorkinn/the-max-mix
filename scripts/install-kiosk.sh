#!/usr/bin/env bash
# Installs THE MAX MIX from a GitHub Release: no git checkout and no build on the device.
# Usage: bash install-kiosk.sh [vX.Y.Z]    (default: the latest release; an older tag rolls back)
# Environment: KIOSK_INSTALL_DIR (default ~/the-max-mix), KIOSK_REPO (default nvorkinn/the-max-mix)
set -euo pipefail

if [[ $(uname -s) != Linux || $(id -u) -eq 0 ]]; then
  echo "Run this installer on Raspberry Pi OS as the normal desktop user, not with sudo." >&2
  exit 1
fi
for dependency in node curl tar systemctl; do
  command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 or newer is required; use Node.js 24 LTS."); process.exit(1); }'

repo=${KIOSK_REPO:-nvorkinn/the-max-mix}
if [[ ! $repo =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "KIOSK_REPO must look like owner/name." >&2
  exit 1
fi
install=${KIOSK_INSTALL_DIR:-$HOME/the-max-mix}
if [[ $install != /* || $install == *$'\n'* || $HOME == *$'\n'* ]]; then
  echo "The install directory must be an absolute path without newlines." >&2
  exit 1
fi
node_bin=$(command -v node)
username=$(id -un)

download() { curl --fail --silent --show-error --location --output "$2" "$1"; }

tag=${1:-}
if [[ -z $tag ]]; then
  latest=$(curl --fail --silent --show-error --location --output /dev/null \
    --write-out '%{url_effective}' "https://github.com/$repo/releases/latest")
  tag=${latest##*/}
fi
if [[ ! $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Could not determine a release version (got '$tag'). Pass one explicitly, e.g. v1.2.3." >&2
  exit 1
fi

name=the-max-mix-$tag
workdir=$(mktemp -d)
staging=
cleanup() { rm -rf "$workdir" ${staging:+"$staging"}; }
trap cleanup EXIT

release=$install/releases/$tag
if [[ ! -d $release ]]; then
  echo "Downloading $name from $repo..."
  base=https://github.com/$repo/releases/download/$tag
  download "$base/$name.tar.gz" "$workdir/$name.tar.gz"
  download "$base/$name.tar.gz.sha256" "$workdir/$name.tar.gz.sha256"
  node --input-type=module - "$workdir/$name.tar.gz" "$workdir/$name.tar.gz.sha256" "$name.tar.gz" <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
const [archive, checksum, expectedName] = process.argv.slice(2);
const [hash, file] = fs.readFileSync(checksum, 'utf8').trim().split(/\s+/);
const actual = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
if (file?.replace(/^\*/, '') !== expectedName || actual !== hash?.toLowerCase()) {
  console.error(`Checksum verification failed for ${expectedName}; refusing to install.`);
  process.exit(1);
}
NODE
  mkdir -p "$install/releases"
  staging=$(mktemp -d "$install/releases/.staging.XXXXXX")
  tar -xzf "$workdir/$name.tar.gz" -C "$staging"
  [[ -d $staging/$name ]] || { echo "Unexpected archive layout in $name.tar.gz." >&2; exit 1; }
  mv "$staging/$name" "$release"
else
  echo "$tag is already downloaded; reusing it."
fi

sudo -v
sudo apt-get update
sudo apt-get install -y chromium curl

# Configuration lives outside the release so upgrades and rollbacks keep it.
if [[ ! -e $install/server.env ]]; then
  install -m 600 "$release/server/.env.example" "$install/server.env"
fi
chmod 600 "$install/server.env"
ln -sfn "$install/server.env" "$release/server/.env"

node --input-type=module - "$install" "$release" "$HOME" "$username" "$node_bin" "$workdir" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [install, release, home, user, node, temporary] = process.argv.slice(2);
// Units and autostart entries point at "current" so a new release only needs the symlink and a restart.
const root = path.join(install, 'current');
const next = `${root}.new`;
fs.rmSync(next, { force: true });
fs.symlinkSync(release, next);
fs.renameSync(next, root);
const { loadConfig } = await import(pathToFileURL(path.join(release, 'server/src/config.js')));
const config = loadConfig();
const quoteUnit = value => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const replacements = { ROOT: root, HOME: home, USER: user, NODE: node, URL: `http://127.0.0.1:${config.port}` };
const render = name => fs.readFileSync(path.join(release, 'scripts', name), 'utf8')
  .replace(/@(ROOT|HOME|USER|NODE|URL)@/g, (_, key) => quoteUnit(replacements[key]));
fs.writeFileSync(path.join(temporary, 'the-max-mix.service'), render('the-max-mix.service'));
const userUnits = path.join(home, '.config/systemd/user');
fs.mkdirSync(userUnits, { recursive: true });
fs.writeFileSync(path.join(userUnits, 'the-max-mix-kiosk.service'), render('the-max-mix-kiosk.service'));
const sessionCommand = `/bin/bash ${shellQuote(path.join(root, 'scripts/start-kiosk-session.sh'))}`;
const labwc = path.join(home, '.config/labwc');
fs.mkdirSync(labwc, { recursive: true });
const autostart = path.join(labwc, 'autostart');
const current = fs.existsSync(autostart) ? fs.readFileSync(autostart, 'utf8') : '';
const start = '# BEGIN THE MAX MIX KIOSK';
const end = '# END THE MAX MIX KIOSK';
const managed = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g');
fs.writeFileSync(autostart, current.replace(managed, '').trimEnd() + `\n\n${start}\n${sessionCommand} &\n${end}\n`);
const xdgAutostart = path.join(home, '.config/autostart');
fs.mkdirSync(xdgAutostart, { recursive: true });
const desktopPath = path.join(root, 'scripts/start-kiosk-session.sh')
  .replace(/[\\`"$]/g, '\\$&').replaceAll('%', '%%');
fs.writeFileSync(path.join(xdgAutostart, 'the-max-mix-kiosk.desktop'),
  `[Desktop Entry]\nType=Application\nName=THE MAX MIX kiosk\nExec=/bin/bash "${desktopPath}"\nTerminal=false\n`);
NODE
sudo install -m 644 "$workdir/the-max-mix.service" /etc/systemd/system/the-max-mix.service
sudo systemctl daemon-reload
sudo systemctl enable the-max-mix.service
sudo systemctl restart the-max-mix.service
systemctl --user daemon-reload

echo "Installed $tag. Edit $install/server.env for Spotify credentials and playback mode."
echo "Enable Desktop Autologin and disable screen blanking in Raspberry Pi OS, then reboot."
echo "Server logs: journalctl -u the-max-mix.service -f"
echo "Kiosk logs: journalctl --user -u the-max-mix-kiosk.service -f"
