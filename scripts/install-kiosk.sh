#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) != Linux || $(id -u) -eq 0 ]]; then
  echo "Run this installer on Raspberry Pi OS as the normal desktop user, not with sudo." >&2
  exit 1
fi
for dependency in node npm curl systemctl; do
  command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 or newer is required; use Node.js 24 LTS."); process.exit(1); }'
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ $root == *$'\n'* || $HOME == *$'\n'* ]]; then
  echo "Installation paths cannot contain newlines." >&2
  exit 1
fi
node_bin=$(command -v node)
username=$(id -un)

sudo -v
sudo apt-get update
sudo apt-get install -y chromium curl

if [[ ! -e "$root/server/.env" ]]; then
  install -m 600 "$root/server/.env.example" "$root/server/.env"
fi
chmod 600 "$root/server/.env"
npm --prefix "$root/client" ci --include=dev
npm --prefix "$root/server" ci --omit=dev
npm --prefix "$root/client" run build

temporary=$(mktemp -d)
trap 'rm -f "$temporary/the-max-mix.service"; rmdir "$temporary"' EXIT
node --input-type=module - "$root" "$HOME" "$username" "$node_bin" "$temporary" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, home, user, node, temporary] = process.argv.slice(2);
const { loadConfig } = await import(pathToFileURL(path.join(root, 'server/src/config.js')));
const config = loadConfig();
const quoteUnit = value => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const replacements = { ROOT: root, HOME: home, USER: user, NODE: node, URL: `http://127.0.0.1:${config.port}` };
const render = name => fs.readFileSync(path.join(root, 'scripts', name), 'utf8')
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
sudo install -m 644 "$temporary/the-max-mix.service" /etc/systemd/system/the-max-mix.service
sudo systemctl daemon-reload
sudo systemctl enable the-max-mix.service
sudo systemctl restart the-max-mix.service
systemctl --user daemon-reload

echo "Installed. Edit $root/server/.env for Spotify credentials and playback mode."
echo "Enable Desktop Autologin and disable screen blanking in Raspberry Pi OS, then reboot."
echo "Server logs: journalctl -u the-max-mix.service -f"
echo "Kiosk logs: journalctl --user -u the-max-mix-kiosk.service -f"
