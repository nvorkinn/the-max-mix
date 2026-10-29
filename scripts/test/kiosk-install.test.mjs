import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, access, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repository = fileURLToPath(new URL('../../', import.meta.url));
const installer = path.join(repository, 'scripts/install-kiosk.sh');
const defaultUrl = 'https://spotify.dev.nikolaivorkinn.com/';
const kioskScripts = ['start-kiosk.sh', 'start-kiosk-session.sh', 'the-max-mix-kiosk.service'];

/** @param {import('node:test').TestContext} t */
async function setup(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'max-mix-install-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const home = path.join(temporary, 'desktop home');
  const bin = path.join(temporary, 'bin');
  const fixtures = path.join(temporary, 'fixtures');
  for (const directory of [bin, fixtures, path.join(home, '.config/labwc')]) {
    await mkdir(directory, { recursive: true });
  }
  // What a download from GitHub would return.
  for (const name of kioskScripts) await copyFile(path.join(repository, 'scripts', name), path.join(fixtures, name));
  const stubs = {
    uname: 'echo Linux',
    id: 'if [[ $1 == -u ]]; then echo 1000; else echo kioskuser; fi',
    systemctl: 'echo "$*" >> "$KIOSK_TEST_STATE/systemctl-calls"',
    curl: `output=; url=
      while (( $# )); do
        case $1 in
          --output) output=$2; shift 2 ;;
          --*) shift ;;
          *) url=$1; shift ;;
        esac
      done
      echo "$url" >> "$KIOSK_TEST_STATE/curl-urls"
      case $url in
        https://raw.githubusercontent.com/*/scripts/*) cp "$KIOSK_TEST_FIXTURES/\${url##*/}" "$output" ;;
        *) exit 22 ;;
      esac`,
    sudo: `case "$1" in
      -v|apt-get) echo "$*" >> "$KIOSK_TEST_STATE/sudo-calls" ;;
      *) echo "Unexpected privileged command" >&2; exit 1 ;;
    esac`
  };
  for (const [name, body] of Object.entries(stubs)) {
    await writeFile(path.join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o755 });
  }
  const install = path.join(temporary, 'install dir with spaces %test');
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env['PATH']}`,
    KIOSK_TEST_STATE: temporary,
    KIOSK_TEST_FIXTURES: fixtures,
    KIOSK_INSTALL_DIR: install,
    KIOSK_REPO: 'test/repo'
  };
  delete env['KIOSK_URL'];
  delete env['KIOSK_REF'];
  const config = path.join(home, '.config/the-max-mix/kiosk.env');
  const unit = path.join(home, '.config/systemd/user/the-max-mix-kiosk.service');
  return { temporary, home, fixtures, install, env, config, unit };
}

/** @param {string} file */
const exists = file =>
  access(file).then(
    () => true,
    () => false
  );

test('installer opens the hosted site by default: env file, unit, autostart entries, no server and no Node', async t => {
  const { temporary, home, install, env, config, unit } = await setup(t);
  await writeFile(path.join(home, '.config/labwc/autostart'), 'existing_desktop_command &\n');
  await run('bash', [installer], { env });

  assert.equal(
    await readFile(config, 'utf8'),
    `# The address THE MAX MIX kiosk opens. Change it, then: systemctl --user restart the-max-mix-kiosk.service\nKIOSK_URL=${defaultUrl}\n`
  );
  assert.equal((await stat(config)).mode & 0o777, 0o600);
  const sudoCalls = await readFile(path.join(temporary, 'sudo-calls'), 'utf8');
  assert.match(sudoCalls, /apt-get install -y chromium curl/);
  assert.ok(!/node|systemctl/.test(sudoCalls));

  const rendered = await readFile(unit, 'utf8');
  assert.ok(
    rendered.includes(`ExecStart=/bin/bash "${path.join(install, 'scripts/start-kiosk.sh').replaceAll('%', '%%')}"`)
  );
  assert.ok(rendered.includes(`EnvironmentFile="${config.replaceAll('%', '%%')}"`));
  assert.ok(!/KIOSK_URL=|@[A-Z]+@/.test(rendered));
  for (const name of ['start-kiosk.sh', 'start-kiosk-session.sh']) {
    assert.equal((await stat(path.join(install, 'scripts', name))).mode & 0o111, 0o111);
  }
  assert.ok(!(await exists(path.join(temporary, 'curl-urls'))), 'a checkout needs no download');

  const autostart = await readFile(path.join(home, '.config/labwc/autostart'), 'utf8');
  assert.equal(autostart.match(/BEGIN THE MAX MIX KIOSK/g)?.length, 1);
  assert.match(autostart, /existing_desktop_command &/);
  assert.ok(autostart.includes(`/bin/bash '${path.join(install, 'scripts/start-kiosk-session.sh')}' &`));
  const desktop = await readFile(path.join(home, '.config/autostart/the-max-mix-kiosk.desktop'), 'utf8');
  assert.match(desktop, /Exec=\/bin\/bash "/);
  assert.match(await readFile(path.join(temporary, 'systemctl-calls'), 'utf8'), /--user daemon-reload/);
});

test('installer stores KIOSK_URL from the environment', async t => {
  const { env, config } = await setup(t);
  await run('bash', [installer], { env: { ...env, KIOSK_URL: 'https://example.vercel.app/' } });
  assert.match(await readFile(config, 'utf8'), /^KIOSK_URL=https:\/\/example\.vercel\.app\/$/m);
  assert.equal((await stat(config)).mode & 0o777, 0o600);
});

test('a re-run keeps the stored address unless KIOSK_URL is given again, and is idempotent', async t => {
  const { home, env, config, unit } = await setup(t);
  await writeFile(path.join(home, '.config/labwc/autostart'), 'existing_desktop_command &\n');
  await run('bash', [installer], { env: { ...env, KIOSK_URL: 'http://127.0.0.1:4173/' } });
  const firstUnit = await readFile(unit, 'utf8');
  // Hand edits survive a plain re-run, which also leaves a single autostart block.
  await writeFile(config, 'EXTRA=1\nKIOSK_URL=http://127.0.0.1:4173/\n', { mode: 0o600 });
  await run('bash', [installer], { env });
  assert.equal(await readFile(config, 'utf8'), 'EXTRA=1\nKIOSK_URL=http://127.0.0.1:4173/\n');
  assert.equal(await readFile(unit, 'utf8'), firstUnit);
  const autostart = await readFile(path.join(home, '.config/labwc/autostart'), 'utf8');
  assert.equal(autostart.match(/BEGIN THE MAX MIX KIOSK/g)?.length, 1);
  assert.equal(autostart.match(/END THE MAX MIX KIOSK/g)?.length, 1);
  assert.match(autostart, /^existing_desktop_command &$/m);

  await run('bash', [installer], { env: { ...env, KIOSK_URL: 'https://example.com/max' } });
  assert.match(await readFile(config, 'utf8'), /^KIOSK_URL=https:\/\/example\.com\/max$/m);
  assert.ok(!(await readFile(config, 'utf8')).includes('4173'));
  assert.equal((await stat(config)).mode & 0o777, 0o600);
});

test('installer accepts a quoted stored address and the last assignment wins', async t => {
  const { temporary, env, config } = await setup(t);
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, 'KIOSK_URL=https://old.example.com/\nKIOSK_URL="https://new.example.com/"\n', {
    mode: 0o600
  });
  const { stdout } = await run('bash', [installer], { env });
  assert.match(stdout, /will open https:\/\/new\.example\.com\//);
  assert.ok(await exists(path.join(temporary, 'sudo-calls')));
});

test('installer accepts http only for the local machine', async t => {
  const { env, config } = await setup(t);
  for (const good of [
    'http://127.0.0.1',
    'http://127.0.0.1:5173/',
    'http://localhost:4173/',
    'https://spotify.example.org/?a=1'
  ]) {
    await run('bash', [installer], { env: { ...env, KIOSK_URL: good } });
    assert.ok((await readFile(config, 'utf8')).includes(`KIOSK_URL=${good}\n`));
  }
});

test('installer rejects an address that is not https or local http, before changing anything', async t => {
  const { temporary, home, install, env, config } = await setup(t);
  const bad = [
    'http://example.com/',
    'http://localhost.example.com/',
    'http://127.0.0.1.example.com/',
    'ftp://example.com/',
    'example.com',
    'https://',
    'https://example.com/ with space',
    'https://example.com/"quoted"',
    "https://example.com/'quoted'",
    'https://example.com/$(touch pwned)',
    'https://example.com/%n',
    'https://example.com/\nExecStart=/bin/true'
  ];
  for (const url of bad) {
    await assert.rejects(
      run('bash', [installer], { env: { ...env, KIOSK_URL: url } }),
      /KIOSK_URL must be an https address/
    );
  }
  assert.ok(!(await exists(config)));
  assert.ok(!(await exists(install)));
  assert.ok(!(await exists(path.join(home, '.config/autostart'))));
  assert.ok(!(await exists(path.join(temporary, 'sudo-calls'))));
  assert.ok(!(await exists(path.join(temporary, 'pwned'))));

  // A stored address is checked too, so a hand edit cannot smuggle something into the unit.
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, 'KIOSK_URL=http://example.com/\n', { mode: 0o600 });
  await assert.rejects(run('bash', [installer], { env }), /KIOSK_URL must be an https address/);
  assert.ok(!(await exists(install)));
});

test('installer outside a checkout downloads the kiosk scripts from GitHub', async t => {
  const { temporary, install, env } = await setup(t);
  const detached = path.join(temporary, 'downloaded');
  await mkdir(detached);
  await copyFile(installer, path.join(detached, 'install-kiosk.sh'));
  await run('bash', [path.join(detached, 'install-kiosk.sh')], { env: { ...env, KIOSK_REF: 'v1.2.3' } });
  const urls = (await readFile(path.join(temporary, 'curl-urls'), 'utf8')).trim().split('\n');
  assert.deepEqual(
    urls,
    kioskScripts.map(name => `https://raw.githubusercontent.com/test/repo/v1.2.3/scripts/${name}`)
  );
  await access(path.join(install, 'scripts/start-kiosk.sh'));
  await access(path.join(install, 'scripts/the-max-mix-kiosk.service'));
});

test('installer refuses to run as root', async t => {
  const { temporary, env } = await setup(t);
  await writeFile(path.join(temporary, 'bin/id'), '#!/usr/bin/env bash\necho 0\n', { mode: 0o755 });
  await assert.rejects(run('bash', [installer], { env }), /not with sudo/);
});
