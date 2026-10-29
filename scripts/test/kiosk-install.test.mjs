import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readlink, realpath, rm, access, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repository = fileURLToPath(new URL('../../', import.meta.url));
const installer = path.join(repository, 'scripts/install-kiosk.sh');

// Builds a minimal release tarball and checksum the way scripts/package-release.sh lays them out.
/**
 * @param {string} fixtures
 * @param {string} tag
 * @param {{ badChecksum?: boolean, template?: boolean }} [options]
 */
async function makeRelease(fixtures, tag, { badChecksum = false, template = true } = {}) {
  const name = `the-max-mix-${tag}`;
  const stage = await mkdtemp(path.join(fixtures, 'stage-'));
  const root = path.join(stage, name);
  for (const directory of ['scripts']) await mkdir(path.join(root, directory), { recursive: true });
  for (const unit of ['the-max-mix.service', 'the-max-mix-kiosk.service']) {
    await copyFile(path.join(repository, 'scripts', unit), path.join(root, 'scripts', unit));
  }
  if (template) {
    await copyFile(path.join(repository, 'scripts/kiosk.env.example'), path.join(root, 'scripts/kiosk.env.example'));
  }
  await writeFile(path.join(root, 'VERSION'), `${tag}\n`);
  const archive = path.join(fixtures, `${name}.tar.gz`);
  await run('tar', ['-czf', archive, '-C', stage, name]);
  const hash = badChecksum
    ? '0'.repeat(64)
    : createHash('sha256')
        .update(await readFile(archive))
        .digest('hex');
  await writeFile(`${archive}.sha256`, `${hash}  ${name}.tar.gz\n`);
}

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
  const stubs = {
    uname: 'echo Linux',
    id: 'if [[ $1 == -u ]]; then echo 1000; else echo kioskuser; fi',
    systemctl: 'exit 0',
    curl: `output=; write=; url=
      while (( $# )); do
        case $1 in
          --output) output=$2; shift 2 ;;
          --write-out) write=$2; shift 2 ;;
          --*) shift ;;
          *) url=$1; shift ;;
        esac
      done
      echo "$url" >> "$KIOSK_TEST_STATE/curl-urls"
      if [[ -n $write ]]; then printf '%s' "https://github.com/test/repo/releases/tag/$KIOSK_TEST_LATEST"; exit 0; fi
      case $url in
        */releases/download/*) cp "$KIOSK_TEST_FIXTURES/\${url##*/}" "$output" ;;
        *) exit 22 ;;
      esac`,
    sudo: `case "$1" in
      -v|apt-get|systemctl) exit 0 ;;
      install) cp "$4" "$KIOSK_TEST_STATE/the-max-mix.service" ;;
      *) echo "Unexpected privileged command" >&2; exit 1 ;;
    esac`
  };
  for (const [name, body] of Object.entries(stubs)) {
    await writeFile(path.join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o755 });
  }
  const install = path.join(temporary, 'install dir with spaces %test');
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env['PATH']}`,
    KIOSK_TEST_STATE: temporary,
    KIOSK_TEST_FIXTURES: fixtures,
    KIOSK_TEST_LATEST: 'v1.2.3',
    KIOSK_INSTALL_DIR: install,
    KIOSK_REPO: 'test/repo'
  };
  return { temporary, home, fixtures, install, env };
}

test('installer fetches the latest release, renders units, preserves configuration and is idempotent', async t => {
  const { temporary, home, fixtures, install, env } = await setup(t);
  await makeRelease(fixtures, 'v1.2.3');
  await mkdir(install, { recursive: true });
  await writeFile(path.join(install, 'kiosk.env'), 'KEEP_EXISTING_CONFIG=true\nPORT=3999\n', { mode: 0o600 });
  await writeFile(path.join(home, '.config/labwc/autostart'), 'existing_desktop_command &\n');
  for (let attempt = 0; attempt < 2; attempt++) await run('bash', [installer], { env });

  assert.equal(await readlink(path.join(install, 'current')), path.join(install, 'releases/v1.2.3'));
  assert.equal(await readFile(path.join(install, 'current/VERSION'), 'utf8'), 'v1.2.3\n');
  assert.equal(await readFile(path.join(install, 'kiosk.env'), 'utf8'), 'KEEP_EXISTING_CONFIG=true\nPORT=3999\n');
  const urls = (await readFile(path.join(temporary, 'curl-urls'), 'utf8')).trim().split('\n');
  const download = 'https://github.com/test/repo/releases/download/v1.2.3/the-max-mix-v1.2.3.tar.gz';
  // The second run asks for the latest release again but reuses the downloaded one.
  assert.deepEqual(urls, [
    'https://github.com/test/repo/releases/latest',
    download,
    `${download}.sha256`,
    'https://github.com/test/repo/releases/latest'
  ]);

  const serverUnit = await readFile(path.join(temporary, 'the-max-mix.service'), 'utf8');
  assert.match(serverUnit, /User=kioskuser/);
  assert.ok(serverUnit.includes(path.join(install, 'current').replaceAll('%', '%%')));
  assert.ok(serverUnit.includes(`"${path.join(install, 'current/scripts/serve.mjs').replaceAll('%', '%%')}"`));
  assert.ok(serverUnit.includes(`EnvironmentFile="${path.join(install, 'kiosk.env').replaceAll('%', '%%')}"`));
  assert.ok(!/StateDirectory|server\//.test(serverUnit));
  assert.match(serverUnit, /ProtectSystem=strict/);
  assert.match(serverUnit, /NoNewPrivileges=true/);
  assert.ok(!/@[A-Z]+@/.test(serverUnit));
  const browserUnit = await readFile(path.join(home, '.config/systemd/user/the-max-mix-kiosk.service'), 'utf8');
  assert.match(browserUnit, /KIOSK_URL=http:\/\/127\.0\.0\.1:3999/);
  const autostart = await readFile(path.join(home, '.config/labwc/autostart'), 'utf8');
  assert.equal(autostart.match(/BEGIN THE MAX MIX KIOSK/g)?.length, 1);
  assert.match(autostart, /existing_desktop_command &/);
  assert.match(
    await readFile(path.join(home, '.config/autostart/the-max-mix-kiosk.desktop'), 'utf8'),
    /Exec=\/bin\/bash "/
  );
});

test('installer creates a private config from the release template and switches versions without losing it', async t => {
  const { install, fixtures, env } = await setup(t);
  await makeRelease(fixtures, 'v1.2.3');
  await makeRelease(fixtures, 'v1.3.0');
  await run('bash', [installer, 'v1.3.0'], { env });
  assert.equal(await readFile(path.join(install, 'current/VERSION'), 'utf8'), 'v1.3.0\n');
  const template = await readFile(path.join(repository, 'scripts/kiosk.env.example'), 'utf8');
  assert.equal(await readFile(path.join(install, 'kiosk.env'), 'utf8'), template);
  assert.equal((await stat(path.join(install, 'kiosk.env'))).mode & 0o777, 0o600);
  await writeFile(path.join(install, 'kiosk.env'), 'PORT=3111\n', { mode: 0o600 });

  await run('bash', [installer, 'v1.2.3'], { env });
  assert.equal(await realpath(path.join(install, 'current')), await realpath(path.join(install, 'releases/v1.2.3')));
  assert.equal(await readFile(path.join(install, 'kiosk.env'), 'utf8'), 'PORT=3111\n');
  await access(path.join(install, 'releases/v1.3.0/VERSION'));
});

test('installer refuses a release whose checksum does not match', async t => {
  const { install, fixtures, env } = await setup(t);
  await makeRelease(fixtures, 'v1.2.3', { badChecksum: true });
  await assert.rejects(run('bash', [installer, 'v1.2.3'], { env }), /Checksum verification failed/);
  await assert.rejects(access(path.join(install, 'current')));
  await assert.rejects(access(path.join(install, 'releases/v1.2.3')));
});

test('installer rejects a version that is not a release tag', async t => {
  const { env } = await setup(t);
  await assert.rejects(run('bash', [installer, 'main'], { env }), /Could not determine a release version/);
});

test('installer keeps the most recently activated releases and prunes the rest', async t => {
  const { install, fixtures, env } = await setup(t);
  const tags = ['v1.0.0', 'v1.1.0', 'v1.2.0', 'v1.3.0'];
  for (const tag of tags) await makeRelease(fixtures, tag);
  await mkdir(install, { recursive: true });
  await writeFile(path.join(install, 'kiosk.env'), 'KEEP=1\n', { mode: 0o600 });
  await mkdir(path.join(install, 'releases/.staging.leftover'), { recursive: true });
  const limited = { ...env, KIOSK_KEEP_RELEASES: '2' };
  for (const tag of tags) {
    await run('bash', [installer, tag], { env: limited });
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  /** @param {string} tag */
  const present = async tag =>
    access(path.join(install, 'releases', tag)).then(
      () => true,
      () => false
    );
  assert.deepEqual(await Promise.all(tags.map(tag => present(tag))), [false, false, true, true]);
  await access(path.join(install, 'releases/.staging.leftover'));
  assert.equal(await readFile(path.join(install, 'kiosk.env'), 'utf8'), 'KEEP=1\n');

  // Rolling back to a kept release makes it the newest, so the other kept one is what a later install prunes first.
  await run('bash', [installer, 'v1.2.0'], { env: limited });
  assert.equal(await readFile(path.join(install, 'current/VERSION'), 'utf8'), 'v1.2.0\n');
  await new Promise(resolve => setTimeout(resolve, 20));
  await run('bash', [installer, 'v1.1.0'], { env: limited });
  assert.deepEqual(await Promise.all(tags.map(tag => present(tag))), [false, true, true, false]);
});

test('installer never prunes the active release and rejects a bad keep count', async t => {
  const { install, fixtures, env } = await setup(t);
  await makeRelease(fixtures, 'v1.2.0');
  await run('bash', [installer, 'v1.2.0'], { env: { ...env, KIOSK_KEEP_RELEASES: '1' } });
  await access(path.join(install, 'releases/v1.2.0'));
  await assert.rejects(
    run('bash', [installer, 'v1.2.0'], { env: { ...env, KIOSK_KEEP_RELEASES: '0' } }),
    /KIOSK_KEEP_RELEASES must be a positive integer/
  );
});

test('shipped env template holds only PORT and HOST with valid defaults', async () => {
  const template = await readFile(path.join(repository, 'scripts/kiosk.env.example'), 'utf8');
  const assignments = template.split('\n').filter(line => line.trim() !== '' && !line.startsWith('#'));
  assert.deepEqual(assignments, ['PORT=3000', 'HOST=127.0.0.1']);
});

test('installer uses PORT from the config for the kiosk URL, accepting quotes and the last assignment', async t => {
  const { home, install, fixtures, env } = await setup(t);
  await makeRelease(fixtures, 'v1.2.3');
  await mkdir(install, { recursive: true });
  await writeFile(path.join(install, 'kiosk.env'), 'PORT=3000\nHOST=0.0.0.0\nPORT="4123"\n', { mode: 0o600 });
  await run('bash', [installer, 'v1.2.3'], { env });
  const unit = await readFile(path.join(home, '.config/systemd/user/the-max-mix-kiosk.service'), 'utf8');
  assert.match(unit, /KIOSK_URL=http:\/\/127\.0\.0\.1:4123/);
});

test('installer defaults to port 3000 when the config has no PORT', async t => {
  const { home, install, fixtures, env } = await setup(t);
  await makeRelease(fixtures, 'v1.2.3');
  await mkdir(install, { recursive: true });
  await writeFile(path.join(install, 'kiosk.env'), 'HOST=127.0.0.1\n', { mode: 0o600 });
  await run('bash', [installer, 'v1.2.3'], { env });
  const unit = await readFile(path.join(home, '.config/systemd/user/the-max-mix-kiosk.service'), 'utf8');
  assert.match(unit, /KIOSK_URL=http:\/\/127\.0\.0\.1:3000/);
});

test('installer rejects an invalid PORT before installing anything', async t => {
  const { temporary, install, fixtures, env } = await setup(t);
  await makeRelease(fixtures, 'v1.2.3');
  await mkdir(install, { recursive: true });
  for (const bad of ['abc', '0', '65536', '80;reboot', '$(touch pwned)']) {
    await writeFile(path.join(install, 'kiosk.env'), `PORT=${bad}\n`, { mode: 0o600 });
    await assert.rejects(run('bash', [installer, 'v1.2.3'], { env }), /PORT in .* must be a number from 1 to 65535/);
  }
  await assert.rejects(access(path.join(install, 'current')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(temporary, 'the-max-mix.service')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(temporary, 'pwned')), { code: 'ENOENT' });
});

test('installer refuses a release without the env template', async t => {
  const { install, fixtures, env } = await setup(t);
  await makeRelease(fixtures, 'v1.2.3', { template: false });
  await assert.rejects(run('bash', [installer, 'v1.2.3'], { env }), /no scripts\/kiosk\.env\.example/);
  await assert.rejects(access(path.join(install, 'current')), { code: 'ENOENT' });
});
