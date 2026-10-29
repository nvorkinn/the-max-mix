import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, readlink, rm, access, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repository = fileURLToPath(new URL('../../', import.meta.url));
const installer = path.join(repository, 'scripts/install-kiosk.sh');
const legacyUrl = 'https://spotify.dev.nikolaivorkinn.com/';
const kioskScripts = [
  'start-kiosk.sh',
  'start-kiosk-session.sh',
  'serve-kiosk.sh',
  'the-max-mix-kiosk.service',
  'the-max-mix-server.service'
];
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/**
 * What the production deployment serves under /kiosk/ for a release: the app as the build leaves it, packed with its
 * checksum (named for the file it sits next to) and the version.
 */
async function publishRelease(temporary: string, fixtures: string, version: string) {
  const app = path.join(temporary, `dist-${version}`);
  await mkdir(path.join(app, 'assets'), { recursive: true });
  await writeFile(path.join(app, 'index.html'), `<!doctype html><title>THE MAX MIX ${version}</title>`);
  await writeFile(path.join(app, 'assets/index.js'), `console.log('${version}');`);
  const archive = path.join(fixtures, 'the-max-mix-latest.tar.gz');
  await run('tar', ['-czf', archive, '-C', app, '.']);
  await writeFile(`${archive}.sha256`, `${sha256(await readFile(archive))}  the-max-mix-latest.tar.gz\n`);
  await writeFile(path.join(fixtures, 'latest-version'), `${version}\n`);
}

async function setup(t: TestContext) {
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
  await publishRelease(temporary, fixtures, '1.2.3');
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
        https://release.example/kiosk/*) cp "$KIOSK_TEST_FIXTURES/\${url##*/}" "$output" ;;
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env['PATH']}`,
    KIOSK_TEST_STATE: temporary,
    KIOSK_TEST_FIXTURES: fixtures,
    KIOSK_INSTALL_DIR: install,
    KIOSK_REPO: 'test/repo',
    KIOSK_RELEASE_URL: 'https://release.example'
  };
  delete env['KIOSK_URL'];
  delete env['KIOSK_PORT'];
  delete env['KIOSK_REF'];
  const config = path.join(home, '.config/the-max-mix/kiosk.env');
  const unit = path.join(home, '.config/systemd/user/the-max-mix-kiosk.service');
  return {
    temporary,
    home,
    fixtures,
    install,
    env,
    config,
    unit,
    publish: (version: string) => publishRelease(temporary, fixtures, version)
  };
}

const isPresent = async (file: string) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

test('installer downloads the release from the production address and sets up the server, the kiosk, the env file and autostart', async t => {
  const { temporary, home, install, env, config, unit, publish } = await setup(t);
  await publish('1.3.0');
  await writeFile(path.join(home, '.config/labwc/autostart'), 'existing_desktop_command &\n');
  const { stdout } = await run('bash', [installer], { env });

  assert.match(stdout, /Installed THE MAX MIX 1\.3\.0\. The kiosk will open http:\/\/127\.0\.0\.1:4173\/ after/);
  assert.match(stdout, /redirect URI .*: http:\/\/127\.0\.0\.1:4173\/$/m);
  const urls = (await readFile(path.join(temporary, 'curl-urls'), 'utf8')).trim().split('\n');
  assert.deepEqual(urls, [
    'https://release.example/kiosk/latest-version',
    'https://release.example/kiosk/the-max-mix-latest.tar.gz',
    'https://release.example/kiosk/the-max-mix-latest.tar.gz.sha256'
  ]);
  assert.match(await readFile(path.join(install, 'app/index.html'), 'utf8'), /THE MAX MIX 1\.3\.0/);
  assert.equal(await readlink(path.join(install, 'app')), path.join(install, 'releases/1.3.0'));

  const settings = await readFile(config, 'utf8');
  assert.match(settings, /^KIOSK_PORT=4173$/m);
  assert.match(settings, /^KIOSK_RELEASE_URL=https:\/\/release\.example$/m);
  assert.ok(!/^KIOSK_URL=/m.test(settings), 'the kiosk defaults to the local app');
  assert.equal((await stat(config)).mode & 0o777, 0o600);
  const sudoCalls = await readFile(path.join(temporary, 'sudo-calls'), 'utf8');
  assert.match(sudoCalls, /apt-get install -y chromium curl python3/);
  assert.ok(!/node|systemctl/.test(sudoCalls));

  const rendered = await readFile(unit, 'utf8');
  assert.ok(
    rendered.includes(`ExecStart=/bin/bash "${path.join(install, 'scripts/start-kiosk.sh').replaceAll('%', '%%')}"`)
  );
  assert.ok(rendered.includes(`EnvironmentFile="${config.replaceAll('%', '%%')}"`));
  assert.match(rendered, /Wants=the-max-mix-server\.service/);
  assert.ok(!/KIOSK_URL=|@[A-Z]+@/.test(rendered));
  const server = await readFile(path.join(home, '.config/systemd/user/the-max-mix-server.service'), 'utf8');
  assert.ok(
    server.includes(`ExecStart=/bin/bash "${path.join(install, 'scripts/serve-kiosk.sh').replaceAll('%', '%%')}"`)
  );
  assert.ok(server.includes(`Environment="KIOSK_APP_DIR=${path.join(install, 'app').replaceAll('%', '%%')}"`));
  assert.ok(!/@[A-Z]+@/.test(server));
  for (const name of ['start-kiosk.sh', 'start-kiosk-session.sh', 'serve-kiosk.sh']) {
    assert.equal((await stat(path.join(install, 'scripts', name))).mode & 0o111, 0o111);
  }

  const autostart = await readFile(path.join(home, '.config/labwc/autostart'), 'utf8');
  assert.equal(autostart.match(/BEGIN THE MAX MIX KIOSK/g)?.length, 1);
  assert.match(autostart, /existing_desktop_command &/);
  assert.ok(autostart.includes(`/bin/bash '${path.join(install, 'scripts/start-kiosk-session.sh')}' &`));
  const desktop = await readFile(path.join(home, '.config/autostart/the-max-mix-kiosk.desktop'), 'utf8');
  assert.match(desktop, /Exec=\/bin\/bash "/);
  const calls = await readFile(path.join(temporary, 'systemctl-calls'), 'utf8');
  assert.match(calls, /--user daemon-reload/);
  assert.match(calls, /--user enable the-max-mix-server\.service/);
  assert.match(calls, /--user try-restart the-max-mix-server\.service/);
});

test('the release address is remembered, so an update needs no variable, and a trailing slash is ignored', async t => {
  const { temporary, install, env, config, publish } = await setup(t);
  const withoutAddress = { ...env };
  delete withoutAddress['KIOSK_RELEASE_URL'];
  await run('bash', [installer], { env: { ...withoutAddress, KIOSK_RELEASE_URL: 'https://release.example/' } });
  assert.match(await readFile(config, 'utf8'), /^KIOSK_RELEASE_URL=https:\/\/release\.example$/m);
  await publish('1.4.0');
  await run('bash', [installer], { env: withoutAddress });
  assert.match(await readFile(path.join(install, 'app/index.html'), 'utf8'), /THE MAX MIX 1\.4\.0/);
  const urls = (await readFile(path.join(temporary, 'curl-urls'), 'utf8')).trim().split('\n');
  assert.ok(urls.every(url => !url.includes('//kiosk') && !url.includes('example//')));
});

test('an update swaps the app atomically and keeps the previous release for rollback', async t => {
  const { install, env, publish } = await setup(t);
  await run('bash', [installer], { env });
  await publish('1.3.0');
  await run('bash', [installer], { env });
  assert.match(await readFile(path.join(install, 'app/index.html'), 'utf8'), /THE MAX MIX 1\.3\.0/);
  assert.equal(await readlink(path.join(install, 'app.previous')), path.join(install, 'releases/1.2.3'));
  assert.match(await readFile(path.join(install, 'app.previous/index.html'), 'utf8'), /THE MAX MIX 1\.2\.3/);
  assert.deepEqual(
    (await readdir(path.join(install, 'releases'))).toSorted((a, b) => a.localeCompare(b)),
    ['1.2.3', '1.3.0']
  );
  // Installing the same version again changes nothing about the rollback target.
  await run('bash', [installer], { env });
  assert.equal(await readlink(path.join(install, 'app.previous')), path.join(install, 'releases/1.2.3'));
});

test('a download that fails its checksum installs nothing', async t => {
  const { temporary, home, fixtures, install, env, config } = await setup(t);
  await writeFile(
    path.join(fixtures, 'the-max-mix-latest.tar.gz.sha256'),
    `${'0'.repeat(64)}  the-max-mix-latest.tar.gz\n`
  );
  await assert.rejects(run('bash', [installer], { env }), /checksum .* does not match/);
  assert.ok(!(await isPresent(install)));
  assert.ok(!(await isPresent(config)));
  assert.ok(!(await isPresent(path.join(home, '.config/systemd'))));
  assert.ok(!(await isPresent(path.join(temporary, 'sudo-calls'))));
});

test('a release without a built app is refused, and so is a version that is not one', async t => {
  const { temporary, fixtures, install, env } = await setup(t);
  const empty = path.join(temporary, 'empty');
  await mkdir(empty);
  await writeFile(path.join(empty, 'readme.txt'), 'not an app');
  const archive = path.join(fixtures, 'the-max-mix-latest.tar.gz');
  await run('tar', ['-czf', archive, '-C', empty, '.']);
  await writeFile(`${archive}.sha256`, `${sha256(await readFile(archive))}  the-max-mix-latest.tar.gz\n`);
  await assert.rejects(run('bash', [installer], { env }), /no index\.html/);
  await writeFile(path.join(fixtures, 'latest-version'), '../etc\n');
  await assert.rejects(run('bash', [installer], { env }), /does not name a version/);
  assert.ok(!(await isPresent(install)));
});

test('installer stores KIOSK_PORT and a custom KIOSK_URL from the environment', async t => {
  const { env, config } = await setup(t);
  const { stdout } = await run('bash', [installer], {
    env: { ...env, KIOSK_PORT: '5000', KIOSK_URL: 'https://example.com/max' }
  });
  const settings = await readFile(config, 'utf8');
  assert.match(settings, /^KIOSK_PORT=5000$/m);
  assert.match(settings, /^KIOSK_URL=https:\/\/example\.com\/max$/m);
  assert.match(stdout, /redirect URI .*: https:\/\/example\.com\/max$/m);
  assert.equal((await stat(config)).mode & 0o777, 0o600);

  await run('bash', [installer], { env: { ...env, KIOSK_PORT: '5001' } });
  const second = await readFile(config, 'utf8');
  assert.match(second, /^KIOSK_PORT=5001$/m);
  assert.match(second, /^KIOSK_URL=https:\/\/example\.com\/max$/m);
});

test('a re-run keeps hand edits and the autostart block stays single', async t => {
  const { home, env, config, unit } = await setup(t);
  await writeFile(path.join(home, '.config/labwc/autostart'), 'existing_desktop_command &\n');
  await run('bash', [installer], { env });
  const firstUnit = await readFile(unit, 'utf8');
  const withoutAddress = { ...env };
  delete withoutAddress['KIOSK_RELEASE_URL'];
  const hand = 'EXTRA=1\nKIOSK_PORT=4999\nKIOSK_RELEASE_URL=https://release.example\n';
  await writeFile(config, hand, { mode: 0o600 });
  const { stdout } = await run('bash', [installer], { env: withoutAddress });
  assert.equal(await readFile(config, 'utf8'), hand);
  assert.match(stdout, /open http:\/\/127\.0\.0\.1:4999\//);
  assert.equal(await readFile(unit, 'utf8'), firstUnit);
  const autostart = await readFile(path.join(home, '.config/labwc/autostart'), 'utf8');
  assert.equal(autostart.match(/BEGIN THE MAX MIX KIOSK/g)?.length, 1);
  assert.equal(autostart.match(/END THE MAX MIX KIOSK/g)?.length, 1);
  assert.match(autostart, /^existing_desktop_command &$/m);
});

test('a stored address from the old hosted setup is replaced by the local app', async t => {
  const { env, config } = await setup(t);
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, `KIOSK_URL=${legacyUrl}\n`, { mode: 0o600 });
  const { stdout } = await run('bash', [installer], { env });
  assert.match(stdout, /will open http:\/\/127\.0\.0\.1:4173\//);
  const settings = await readFile(config, 'utf8');
  assert.match(settings, /^KIOSK_PORT=4173$/m);
  assert.doesNotMatch(settings, /^KIOSK_URL=/m);
});

test('installer accepts a quoted stored address and the last assignment wins', async t => {
  const { temporary, env, config } = await setup(t);
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, 'KIOSK_URL=https://old.example.com/\nKIOSK_URL="https://new.example.com/"\n', {
    mode: 0o600
  });
  const { stdout } = await run('bash', [installer], { env });
  assert.match(stdout, /will open https:\/\/new\.example\.com\//);
  assert.ok(await isPresent(path.join(temporary, 'sudo-calls')));
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

test('installer rejects a bad address, port or version before changing anything', async t => {
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
  for (const port of ['80', '1023', '65536', '0123', '4173; id', 'abc']) {
    await assert.rejects(
      run('bash', [installer], { env: { ...env, KIOSK_PORT: port } }),
      /KIOSK_PORT must be a number/
    );
  }
  for (const address of [
    'http://release.example',
    'https://',
    'https://a b',
    'https://a/"x"',
    'https://a?x=1',
    'ftp://a'
  ]) {
    await assert.rejects(
      run('bash', [installer], { env: { ...env, KIOSK_RELEASE_URL: address } }),
      /KIOSK_RELEASE_URL must be an https address/
    );
  }
  assert.ok(!(await isPresent(config)));
  assert.ok(!(await isPresent(install)));
  assert.ok(!(await isPresent(path.join(home, '.config/autostart'))));
  assert.ok(!(await isPresent(path.join(temporary, 'sudo-calls'))));
  assert.ok(!(await isPresent(path.join(temporary, 'curl-urls'))));
  assert.ok(!(await isPresent(path.join(temporary, 'pwned'))));

  // Stored settings are checked too, so a hand edit cannot smuggle something into the unit.
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, 'KIOSK_URL=http://example.com/\n', { mode: 0o600 });
  await assert.rejects(run('bash', [installer], { env }), /KIOSK_URL must be an https address/);
  await writeFile(config, 'KIOSK_PORT=22\n', { mode: 0o600 });
  await assert.rejects(run('bash', [installer], { env }), /KIOSK_PORT must be a number/);
  assert.ok(!(await isPresent(install)));
});

test('installer outside a checkout downloads the kiosk scripts from GitHub', async t => {
  const { temporary, install, env } = await setup(t);
  const detached = path.join(temporary, 'downloaded');
  await mkdir(detached);
  await copyFile(installer, path.join(detached, 'install-kiosk.sh'));
  await run('bash', [path.join(detached, 'install-kiosk.sh')], { env: { ...env, KIOSK_REF: 'v1.2.3' } });
  const urls = (await readFile(path.join(temporary, 'curl-urls'), 'utf8')).trim().split('\n');
  assert.deepEqual(
    urls.slice(0, kioskScripts.length),
    kioskScripts.map(name => `https://raw.githubusercontent.com/test/repo/v1.2.3/scripts/${name}`)
  );
  await access(path.join(install, 'scripts/start-kiosk.sh'));
  await access(path.join(install, 'scripts/serve-kiosk.sh'));
  await access(path.join(install, 'scripts/the-max-mix-server.service'));
});

test('installer refuses to run as root', async t => {
  const { temporary, env } = await setup(t);
  await writeFile(path.join(temporary, 'bin/id'), '#!/usr/bin/env bash\necho 0\n', { mode: 0o755 });
  await assert.rejects(run('bash', [installer], { env }), /not with sudo/);
});

test('serve-kiosk.sh serves the app on the loopback address, with query parameters and no rewrites', async t => {
  const { temporary, env } = await setup(t);
  const server = path.join(repository, 'scripts/serve-kiosk.sh');
  const app = path.join(temporary, 'dist-1.2.3');
  const port = '48173';
  const controller = new AbortController();
  // Stopping the server rejects this promise; it is only awaited to keep the rejection handled.
  const stopped = (async () => {
    try {
      await run('bash', [server], { env: { ...env, KIOSK_APP_DIR: app, KIOSK_PORT: port }, signal: controller.signal });
    } catch {
      // Aborted below.
    }
  })();
  t.after(async () => {
    controller.abort();
    await stopped;
  });
  let response: Response | undefined;
  for (let attempt = 0; !response && attempt < 50; attempt++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/?demo=true`);
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.ok(response, 'the server answers on 127.0.0.1');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /THE MAX MIX 1\.2\.3/);

  await assert.rejects(
    run('bash', [server], { env: { ...env, KIOSK_APP_DIR: app, KIOSK_PORT: '22' } }),
    /KIOSK_PORT must be a number/
  );
  await assert.rejects(
    run('bash', [server], { env: { ...env, KIOSK_APP_DIR: temporary, KIOSK_PORT: port } }),
    /No app found/
  );
});

test('KIOSK_RELEASE_URL is required when none is stored, and nothing is changed without it', async t => {
  const { temporary, install, env, config } = await setup(t);
  const withoutAddress = { ...env };
  delete withoutAddress['KIOSK_RELEASE_URL'];
  await assert.rejects(run('bash', [installer], { env: withoutAddress }), /KIOSK_RELEASE_URL is required/);
  assert.ok(!(await isPresent(install)));
  assert.ok(!(await isPresent(config)));
  assert.ok(!(await isPresent(path.join(temporary, 'sudo-calls'))));
});
