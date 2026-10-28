import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const run = promisify(execFile);
const repository = fileURLToPath(new URL('../../', import.meta.url));

test('installer renders user-specific units, preserves configuration and is idempotent', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'max-mix-install-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'checkout with spaces %test');
  const home = path.join(temporary, 'desktop home');
  const bin = path.join(temporary, 'bin');
  for (const directory of [bin, path.join(root, 'scripts'), path.join(root, 'server/src'), path.join(home, '.config/labwc')]) {
    await mkdir(directory, { recursive: true });
  }
  for (const name of ['install-kiosk.sh', 'the-max-mix.service', 'the-max-mix-kiosk.service']) {
    await copyFile(path.join(repository, 'scripts', name), path.join(root, 'scripts', name));
  }
  await writeFile(path.join(root, 'server/package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'server/src/config.js'), 'export function loadConfig() { return { port: 3999 }; }\n');
  await writeFile(path.join(root, 'server/.env'), 'KEEP_EXISTING_CONFIG=true\n', { mode: 0o600 });
  await writeFile(path.join(home, '.config/labwc/autostart'), 'existing_desktop_command &\n');
  const stubs = {
    uname: 'echo Linux',
    id: 'if [[ $1 == -u ]]; then echo 1000; else echo kioskuser; fi',
    npm: 'exit 0',
    curl: 'exit 0',
    systemctl: 'exit 0',
    sudo: `case "$1" in
      -v|apt-get|systemctl) exit 0 ;;
      install) cp "$4" "$KIOSK_TEST_STATE/the-max-mix.service" ;;
      *) echo "Unexpected privileged command" >&2; exit 1 ;;
    esac`
  };
  for (const [name, body] of Object.entries(stubs)) {
    await writeFile(path.join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o755 });
  }
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, KIOSK_TEST_STATE: temporary };
  for (let attempt = 0; attempt < 2; attempt++) await run('bash', [path.join(root, 'scripts/install-kiosk.sh')], { env });
  assert.equal(await readFile(path.join(root, 'server/.env'), 'utf8'), 'KEEP_EXISTING_CONFIG=true\n');
  const serverUnit = await readFile(path.join(temporary, 'the-max-mix.service'), 'utf8');
  assert.match(serverUnit, /User=kioskuser/);
  assert(serverUnit.includes(root.replaceAll('%', '%%')));
  assert.match(serverUnit, /StateDirectoryMode=0700/);
  assert(!/@ROOT@|@USER@|@NODE@/.test(serverUnit));
  const browserUnit = await readFile(path.join(home, '.config/systemd/user/the-max-mix-kiosk.service'), 'utf8');
  assert.match(browserUnit, /KIOSK_URL=http:\/\/127\.0\.0\.1:3999/);
  const autostart = await readFile(path.join(home, '.config/labwc/autostart'), 'utf8');
  assert.equal(autostart.match(/BEGIN THE MAX MIX KIOSK/g).length, 1);
  assert.match(autostart, /existing_desktop_command &/);
  assert.match(await readFile(path.join(home, '.config/autostart/the-max-mix-kiosk.desktop'), 'utf8'), /Exec=\/bin\/bash "/);
});
