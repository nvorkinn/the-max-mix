#!/usr/bin/env bash
# Installs THE MAX MIX from a GitHub Release: no git checkout and no build on the device.
# Usage: bash install-kiosk.sh [vX.Y.Z]    (default: the latest release; an older tag rolls back)
# Environment: KIOSK_INSTALL_DIR (default ~/the-max-mix), KIOSK_REPO (default nvorkinn/the-max-mix),
#              KIOSK_KEEP_RELEASES (how many releases to keep on disk, default 3)
# The Spotify client ID is baked into the release's built files at build time, so it is not asked for here.
# Runtime settings (PORT, HOST) live in $KIOSK_INSTALL_DIR/kiosk.env, created from the release's template on first
# install and kept across upgrades and rollbacks.
set -euo pipefail

if [[ $(uname -s) != Linux || $(id -u) -eq 0 ]]; then
  echo "Run this installer on Raspberry Pi OS as the normal desktop user, not with sudo." >&2
  exit 1
fi
for dependency in node curl tar systemctl; do
  command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node.js 24 or newer is required; use Node.js 24 LTS."); process.exit(1); }'

repo=${KIOSK_REPO:-nvorkinn/the-max-mix}
if [[ ! $repo =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "KIOSK_REPO must look like owner/name." >&2
  exit 1
fi
keep=${KIOSK_KEEP_RELEASES:-3}
if [[ ! $keep =~ ^[1-9][0-9]*$ ]]; then
  echo "KIOSK_KEEP_RELEASES must be a positive integer." >&2
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

# Configuration lives outside the release so upgrades and rollbacks keep it.
config=$install/kiosk.env
if [[ ! -e $config ]]; then
  [[ -f $release/scripts/kiosk.env.example ]] || { echo "This release has no scripts/kiosk.env.example." >&2; exit 1; }
  install -m 600 "$release/scripts/kiosk.env.example" "$config"
fi
chmod 600 "$config"
# The last PORT= line wins (as in systemd); it may be quoted. Default 3000 when absent or empty.
port=$(sed -n 's/^PORT=//p' "$config" | tail -n 1 | tr -d "\"'\r")
port=${port:-3000}
if [[ ! $port =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
  echo "PORT in $config must be a number from 1 to 65535, got: $port" >&2
  exit 1
fi

sudo -v
sudo apt-get update
sudo apt-get install -y chromium curl

node --input-type=module - "$install" "$release" "$HOME" "$username" "$node_bin" "$workdir" "$port" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [install, release, home, user, node, temporary, port] = process.argv.slice(2);
// Units and autostart entries point at "current" so a new release only needs the symlink and a restart.
const root = path.join(install, 'current');
const next = `${root}.new`;
fs.rmSync(next, { force: true });
fs.symlinkSync(release, next);
fs.renameSync(next, root);
// Releases are pruned by activation time, so touch this one: a rollback counts as the newest.
fs.utimesSync(release, new Date(), new Date());
const quoteUnit = value => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const replacements = { ROOT: root, HOME: home, USER: user, NODE: node, ENV: path.join(install, 'kiosk.env'), URL: `http://127.0.0.1:${port}` };
const render = name => fs.readFileSync(path.join(release, 'scripts', name), 'utf8')
  .replace(/@(ROOT|HOME|USER|NODE|ENV|URL)@/g, (_, key) => quoteUnit(replacements[key]));
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

# Keep the active release and the most recently activated ones (KIOSK_KEEP_RELEASES in total); remove the rest.
node --input-type=module - "$install" "$keep" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [install, keep] = process.argv.slice(2);
const releases = path.join(install, 'releases');
const active = fs.realpathSync(path.join(install, 'current'));
const candidates = fs.readdirSync(releases, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(entry.name))
  .map(entry => path.join(releases, entry.name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
for (const directory of candidates.slice(Number(keep))) {
  if (fs.realpathSync(directory) === active) continue;
  fs.rmSync(directory, { recursive: true, force: true });
  console.log(`Removed old release ${path.basename(directory)}.`);
}
NODE

echo "Installed $tag. Edit $install/kiosk.env to change PORT or HOST, then: sudo systemctl restart the-max-mix.service"
echo "Enable Desktop Autologin and disable screen blanking in Raspberry Pi OS, then reboot."
echo "Server logs: journalctl -u the-max-mix.service -f"
echo "Kiosk logs: journalctl --user -u the-max-mix-kiosk.service -f"
