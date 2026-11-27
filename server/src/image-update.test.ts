// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  afterBoot,
  APP_RELEASE_ENV,
  apply,
  check,
  giveUp,
  cmdlineWithRoot,
  configWithOwn,
  installedBootDevice,
  installedRootLabel,
  KIOSK_ENV,
  keep,
  parseChannel,
  parseEnv,
  parseManifest,
  parsePointer,
  pointerUrl,
  RELEASE_ENV,
  restart,
  rollback,
  run,
  STABLE_EVERY_MS,
  STATE_FILE
} from './image-update.ts';
import type { UpdateIO, UpdateState } from './image-update.ts';
import type { Progress, Rauc, Slot } from './rauc.ts';

const RELEASES = 'https://github.com/nvorkinn/the-max-mix/releases';
const DEV = `${RELEASES}/download/dev/the-max-mix-bbb.raucb`;

/** A Pi on slot a running dev+aaa, with RAUC and GitHub faked: the test sets what the channel has. */
function pi(options: { channel?: string; state?: Partial<UpdateState>; trial?: boolean; booted?: string } = {}) {
  const booted = options.booted ?? 'a';
  const other = booted === 'a' ? 'b' : 'a';
  const state: UpdateState = { pending: null, failed: [], seen: null, checkedAt: null, ...options.state };
  const world = {
    files: {
      [KIOSK_ENV]: `# This Pi\nKIOSK_NAME=Kitchen\nKIOSK_UPDATE_CHANNEL="${options.channel ?? 'dev'}"\n`,
      [RELEASE_ENV]: 'KIOSK_RELEASE_REF=dev\nKIOSK_RELEASE_COMMIT=aaa\n'
    } as Record<string, string>,
    state,
    remote: {
      pointer: `${DEV}\n` as string | null,
      version: 'dev+bbb',
      isOffline: false,
      /** The app on its own beside the bundle: its manifest, when the release has one. */
      manifest: null as string | null
    },
    /** The apps on /data: each one's `over`, the links, and what was asked of the store. */
    apps: {
      over: {} as Record<string, string>,
      inUse: null as string | null,
      previous: null as string | null,
      isTrial: false,
      isSigned: true,
      isLocked: false,
      fetched: [] as string[],
      pruned: [] as string[][]
    },
    /** What the health check finds after a change-over: null is healthy. */
    wrong: null as string | null,
    fetched: [] as string[],
    inspected: [] as string[],
    installed: [] as string[],
    marks: [] as string[],
    ran: [] as string[][],
    log: [] as string[],
    operation: 'idle',
    slots: [
      { name: 'rootfs.0', class: 'rootfs', bootname: 'a', state: 'booted', bundleVersion: null },
      { name: 'rootfs.1', class: 'rootfs', bootname: 'b', state: 'inactive', bundleVersion: 'dev+old' },
      { name: 'boot.0', class: 'boot', bootname: null, state: 'booted', bundleVersion: null }
    ] as Slot[],
    now: 1_000_000_000,
    isTrybootBroken: false
  };
  const rauc: Rauc = {
    bootSlot: () => Promise.resolve(booted),
    operation: () => Promise.resolve(world.operation),
    slots: () => Promise.resolve(world.slots),
    inspect: url => {
      world.inspected.push(url);
      return Promise.resolve(world.remote.version);
    },
    install: (url, onProgress: (progress: Progress) => void) => {
      world.installed.push(url);
      onProgress({ percent: 0, message: 'Installing' });
      onProgress({ percent: 0, message: 'Installing' });
      onProgress({ percent: 100, message: '' });
      world.slots = world.slots.map(slot =>
        slot.bootname === other ? { ...slot, bundleVersion: world.remote.version } : slot
      );
      return Promise.resolve();
    },
    mark: (mark, slot) => {
      world.marks.push(`${mark} ${slot}`);
      return Promise.resolve();
    },
    close: () => Promise.resolve()
  };
  const io: UpdateIO = {
    rauc,
    readText: file => Promise.resolve(file === STATE_FILE ? JSON.stringify(world.state) : (world.files[file] ?? null)),
    writeState: next => {
      world.state = next;
      return Promise.resolve();
    },
    fetchText: url => {
      world.fetched.push(url);
      if (world.remote.isOffline) return Promise.reject(new Error('offline'));
      return Promise.resolve(url.endsWith('.app.json') ? world.remote.manifest : world.remote.pointer);
    },
    fetchBytes: url => {
      world.fetched.push(url);
      return Promise.resolve(world.remote.manifest === null ? null : Buffer.from('signature'));
    },
    apps: {
      folder: version => `/apps/${version}`,
      inUse: () => Promise.resolve(world.apps.inUse),
      previous: () => Promise.resolve(world.apps.previous),
      over: version => Promise.resolve(world.apps.over[version] ?? null),
      isTrial: () => Promise.resolve(world.apps.isTrial),
      setTrial: isTrial => {
        world.apps.isTrial = isTrial;
        return Promise.resolve();
      },
      isSigned: () => Promise.resolve(world.apps.isSigned),
      fetch: (url, _expected, version, over) => {
        world.apps.fetched.push(url);
        world.apps.over[version] = over;
        return Promise.resolve();
      },
      use: (version, previous) => {
        world.apps.inUse = version;
        world.apps.previous = previous;
        const [ref = '', commit = ''] = (version ?? '').split('+', 2);
        world.files[APP_RELEASE_ENV] =
          version === null ? '' : `KIOSK_RELEASE_REF=${ref}\nKIOSK_RELEASE_COMMIT=${commit}\n`;
        return Promise.resolve();
      },
      prune: kept => {
        world.apps.pruned.push(kept);
        return Promise.resolve();
      },
      lock: () => Promise.resolve(!world.apps.isLocked),
      unlock: () => Promise.resolve()
    },
    health: () => Promise.resolve(world.wrong),
    run: argv => {
      world.ran.push(argv);
      return Promise.resolve();
    },
    tryboot: () => {
      if (world.isTrybootBroken) return Promise.reject(new Error('reboot failed'));
      world.ran.push(['tryboot']);
      return Promise.resolve();
    },
    isTrialBoot: () => Promise.resolve(options.trial ?? false),
    now: () => world.now,
    log: line => {
      world.log.push(line);
    }
  };
  return { io, world };
}

describe('settings', () => {
  it('reads KEY=value files as systemd does', () => {
    expect(parseEnv('# note\nA=1\n B = "two words" \nC=\'x\'\nnot a line\n#D=4')).toEqual({
      A: '1',
      B: 'two words',
      C: 'x'
    });
  });

  it('takes stable, dev and branch channels, and stable for anything else', () => {
    expect(parseChannel('dev')).toBe('dev');
    expect(parseChannel('branch-feature-x')).toBe('branch-feature-x');
    expect(parseChannel(undefined)).toBe('stable');
    expect(parseChannel('')).toBe('stable');
    expect(parseChannel('branch-../x')).toBe('stable');
    expect(parseChannel('nightly')).toBe('stable');
  });

  it('reads the latest release’s bundle.txt, or the channel’s pre-release’s', () => {
    expect(pointerUrl('stable')).toBe(`${RELEASES}/latest/download/bundle.txt`);
    expect(pointerUrl('dev')).toBe(`${RELEASES}/download/dev/bundle.txt`);
    expect(pointerUrl('branch-x')).toBe(`${RELEASES}/download/branch-x/bundle.txt`);
  });

  it('follows bundle.txt only to a bundle on one of the repository’s releases', () => {
    expect(parsePointer(`${DEV}\n`)).toBe(DEV);
    expect(parsePointer(`${RELEASES}/download/v2.53.0/the-max-mix-v2.53.0.raucb`)).toBe(
      `${RELEASES}/download/v2.53.0/the-max-mix-v2.53.0.raucb`
    );
    expect(parsePointer('https://example.test/download/dev/the-max-mix.raucb')).toBeNull();
    expect(parsePointer(`${RELEASES}/download/dev/../x/the-max-mix.raucb`)).toBeNull();
    expect(parsePointer(`${RELEASES}/download/../the-max-mix.raucb`)).toBeNull();
    expect(parsePointer(`${RELEASES}/download/dev/notes.txt`)).toBeNull();
    expect(parsePointer('')).toBeNull();
  });
});

describe('check', () => {
  it('offers a newer version, and reads an unchanged bundle only once', async () => {
    const { io, world } = pi();
    await expect(check(io, true)).resolves.toEqual({
      channel: 'dev',
      current: 'dev+aaa',
      installed: null,
      failed: null,
      busy: false,
      result: 'available',
      latest: 'dev+bbb'
    });
    await check(io, true);
    expect(world.inspected).toEqual([DEV]);
    expect(world.fetched).toEqual([`${RELEASES}/download/dev/bundle.txt`, `${RELEASES}/download/dev/bundle.txt`]);
    world.remote.pointer = `${RELEASES}/download/dev/the-max-mix-ccc.raucb`;
    await check(io, true);
    expect(world.inspected).toHaveLength(2);
  });

  it('keeps nothing when the screen asks (it may not write)', async () => {
    const { io, world } = pi();
    await check(io);
    expect(world.state.seen).toBeNull();
  });

  it('tells up to date, installed, failed, nothing published and offline apart', async () => {
    const { io, world } = pi();
    world.remote.version = 'dev+aaa';
    expect((await check(io)).result).toBe('up-to-date');
    world.remote.version = 'dev+bbb';
    world.state.pending = { version: 'dev+bbb', slot: 'b', tried: false };
    expect((await check(io)).result).toBe('installed');
    world.state = { ...world.state, pending: null, failed: ['dev+bbb'] };
    expect(await check(io)).toMatchObject({ result: 'failed', failed: 'dev+bbb' });
    world.remote.pointer = null;
    expect((await check(io)).result).toBe('none');
    world.remote.isOffline = true;
    expect(await check(io)).toMatchObject({ result: 'unreachable', latest: null });
  });
});

describe('run', () => {
  it('installs a newer version with its progress, and on dev restarts into it at once', async () => {
    const { io, world } = pi();
    const done = await run(io, true);
    expect(done).toMatchObject({ result: 'installed', installed: 'dev+bbb' });
    expect(world.installed).toEqual([DEV]);
    expect(world.log).toEqual([
      'Installing dev+bbb.',
      'Update progress: 0% Installing',
      'Update progress: 100%',
      'Installed dev+bbb. It starts with the next restart.',
      'Restarting into the update.'
    ]);
    expect(world.state.pending).toEqual({ version: 'dev+bbb', slot: 'b', tried: true });
    expect(world.ran).toEqual([['tryboot']]);
  });

  it('keeps an install waiting when the reboot into it fails, and does not install it again', async () => {
    const { io, world } = pi();
    world.isTrybootBroken = true;
    await expect(run(io, true)).rejects.toThrow('reboot failed');
    expect(world.state.pending).toEqual({ version: 'dev+bbb', slot: 'b', tried: false });
    world.isTrybootBroken = false;
    world.now += 2 * 60 * 1000;
    await run(io, true);
    expect(world.installed).toEqual([DEV]);
    expect(world.ran).toEqual([['tryboot']]);
  });

  it('leaves a stable Pi’s install for the next restart, and checks it every 6 hours only', async () => {
    const { io, world } = pi({ channel: 'stable' });
    world.files[RELEASE_ENV] = 'KIOSK_RELEASE_REF=v1.0.0\nKIOSK_RELEASE_COMMIT=aaa\n';
    world.remote.version = 'v1.1.0+bbb';
    await run(io, true);
    expect(world.state.pending).toEqual({ version: 'v1.1.0+bbb', slot: 'b', tried: false });
    expect(world.ran).toEqual([]);

    world.remote.pointer = `${RELEASES}/download/v1.1.0/the-max-mix-v1.1.0.raucb`;
    world.now += STABLE_EVERY_MS - 1;
    await expect(run(io, true)).resolves.toBeNull();
    expect(world.inspected).toHaveLength(1);
    // The screen's Install is not held back.
    await run(io, false);
    expect(world.inspected).toHaveLength(2);
  });

  it('does not install a version that failed here, or while RAUC is busy', async () => {
    const { io, world } = pi({ state: { failed: ['dev+bbb'] } });
    await run(io, false);
    expect(world.installed).toEqual([]);
    expect(world.log).toEqual(['dev+bbb failed on this Pi before, so it is not installed again.']);
    world.operation = 'installing';
    await expect(run(io, false)).resolves.toBeNull();
  });
});

describe('restart', () => {
  it('reboots into a waiting update once, otherwise restarts the kiosk', async () => {
    const { io, world } = pi({ state: { pending: { version: 'v2+bbb', slot: 'b', tried: false } } });
    await restart(io);
    await restart(io);
    expect(world.ran).toEqual([['tryboot'], ['/usr/bin/systemctl', 'restart', 'kiosk.service']]);
    await expect(apply(io)).resolves.toBe('none');
  });
});

describe('after a boot', () => {
  it('lets the health check decide on the first boot of a new slot, and keeps it when healthy', async () => {
    const { io, world } = pi({
      booted: 'b',
      trial: true,
      state: { pending: { version: 'dev+bbb', slot: 'b', tried: true } }
    });
    const boot = await afterBoot(io);
    expect(boot).toBe('trial');
    await keep(io, boot);
    expect(world.marks).toEqual(['good booted']);
    expect(world.state.pending).toBeNull();
  });

  it('goes back to the old slot when the new one is not healthy, and never retries it', async () => {
    const { io, world } = pi({
      booted: 'b',
      trial: true,
      state: { pending: { version: 'dev+bbb', slot: 'b', tried: true } }
    });
    await giveUp(io, await afterBoot(io), 'Chromium is not running.');
    expect(world.marks).toEqual(['bad booted']);
    expect(world.state).toMatchObject({ pending: null, failed: ['dev+bbb'] });
    expect(world.ran).toEqual([['/usr/bin/systemctl', 'reboot']]);
  });

  it('counts a tried slot the Pi did not come back on (a hang or a panic) as failed', async () => {
    const { io, world } = pi({ booted: 'a', state: { pending: { version: 'dev+bbb', slot: 'b', tried: true } } });
    await expect(afterBoot(io)).resolves.toBe('normal');
    expect(world.marks).toEqual(['bad other']);
    expect(world.state).toMatchObject({ pending: null, failed: ['dev+bbb'] });
  });

  it('gives up on a trial boot it has no note for, such as an install by hand', async () => {
    const { io, world } = pi({ booted: 'b', trial: true });
    const boot = await afterBoot(io);
    expect(boot).toBe('trial');
    await giveUp(io, boot, 'Cage is not running.');
    expect(world.marks).toEqual(['bad booted']);
    expect(world.ran).toEqual([['/usr/bin/systemctl', 'reboot']]);
  });

  it('only marks an ordinary boot good, and never reboots it', async () => {
    const { io, world } = pi({ state: { pending: { version: 'v2+bbb', slot: 'b', tried: false } } });
    const boot = await afterBoot(io);
    await keep(io, boot);
    await giveUp(io, boot, 'Cage is not running.');
    expect(world.marks).toEqual(['good booted']);
    expect(world.ran).toEqual([]);
    expect(world.state.pending).toEqual({ version: 'v2+bbb', slot: 'b', tried: false });
  });
});

describe('rollback', () => {
  it('tries the other slot now and does not reinstall the version left behind', async () => {
    const { io, world } = pi();
    await rollback(io);
    expect(world.marks).toEqual(['active other']);
    expect(world.state).toMatchObject({ pending: { version: 'dev+old', slot: 'b', tried: true }, failed: ['dev+aaa'] });
    expect(world.ran).toEqual([['tryboot']]);
  });
});

describe('installedBootDevice', () => {
  it('finds the boot slot RAUC wrote', () => {
    expect(
      installedBootDevice({
        RAUC_TARGET_SLOTS: '1 2',
        RAUC_SLOT_CLASS_1: 'rootfs',
        RAUC_SLOT_DEVICE_1: '/dev/disk/by-partlabel/root-b',
        RAUC_SLOT_CLASS_2: 'boot',
        RAUC_SLOT_DEVICE_2: '/dev/disk/by-partlabel/boot-b'
      })
    ).toBe('/dev/disk/by-partlabel/boot-b');
    expect(installedBootDevice({})).toBeNull();
  });
});

describe('installedRootLabel', () => {
  it('finds the root slot RAUC wrote', () => {
    expect(
      installedRootLabel({
        RAUC_TARGET_SLOTS: '1 2',
        RAUC_SLOT_CLASS_1: 'rootfs',
        RAUC_SLOT_DEVICE_1: '/dev/disk/by-partlabel/root-b',
        RAUC_SLOT_CLASS_2: 'boot',
        RAUC_SLOT_DEVICE_2: '/dev/disk/by-partlabel/boot-b'
      })
    ).toBe('root-b');
    expect(installedRootLabel({})).toBeNull();
  });
});

describe('configWithOwn', () => {
  const IMAGE = "# The image's settings\ndtoverlay=vc4-kms-v3d\n\n[pi5]\nkernel=kernel8.img\n\n[all]\n";
  const OWN = '# The Waveshare screen\ndtoverlay=vc4-kms-dsi-waveshare-panel,10_1_inch,dsi0\n';

  it("puts the Pi's own lines at the end, for every model", () => {
    const config = configWithOwn(IMAGE, OWN);
    expect(config.startsWith(IMAGE.trimEnd())).toBe(true);
    expect(config).toMatch(
      /\n\n# The Pi's own settings.*\n\[all\]\n# The Waveshare screen\ndtoverlay=vc4-kms-dsi-waveshare-panel,10_1_inch,dsi0\n# The end of the Pi's own settings\.\n$/
    );
  });

  it('writes the same file again, and replaces the lines written before', () => {
    const config = configWithOwn(IMAGE, OWN);
    expect(configWithOwn(config, OWN)).toBe(config);
    const changed = configWithOwn(config, 'camera_auto_detect=1\r\n\r\n');
    expect(changed).toContain('[all]\ncamera_auto_detect=1\n# The end');
    expect(changed).not.toContain('waveshare');
  });

  it("leaves only the image's settings when the Pi has none of its own", () => {
    expect(configWithOwn(configWithOwn(IMAGE, OWN), '')).toBe(IMAGE);
    expect(configWithOwn(IMAGE, '\n  \n')).toBe(IMAGE);
  });
});

describe('cmdlineWithRoot', () => {
  it('points the bundle slot-a command line at slot b', () => {
    expect(cmdlineWithRoot('console=tty3 root=PARTLABEL=root-a rootfstype=ext4 ro quiet\n', 'root-b')).toBe(
      'root=PARTLABEL=root-b console=tty3 rootfstype=ext4 ro quiet\n'
    );
  });

  it('adds root= to a line without one', () => {
    expect(cmdlineWithRoot('quiet', 'root-a')).toBe('root=PARTLABEL=root-a quiet\n');
  });
});

/** The manifest of dev+bbb's app on its own, built with OS os1. */
const manifest = (fields: object = {}) =>
  JSON.stringify({ version: 'dev+bbb', os: 'os1', sha256: 'a'.repeat(64), size: 1234, ...fields });

/** A Pi whose slot (dev+aaa) was built with OS os1, on a channel whose release has the app on its own. */
function appPi(options: Parameters<typeof pi>[0] = {}) {
  const made = pi(options);
  made.world.files[RELEASE_ENV] = 'KIOSK_RELEASE_REF=dev\nKIOSK_RELEASE_COMMIT=aaa\nKIOSK_RELEASE_OS=os1\n';
  made.world.remote.manifest = manifest();
  return made;
}

describe('a release that changed only the app', () => {
  const APP = `${RELEASES}/download/dev/the-max-mix-bbb.app`;
  const RESTARTS = [
    ['/usr/bin/systemctl', '--user', '--machine=kiosk@', 'restart', 'kiosk-server.service'],
    ['/usr/bin/systemctl', 'restart', 'kiosk.service']
  ];
  it('reads a manifest, and nothing else', () => {
    expect(parseManifest(manifest())).toEqual({ version: 'dev+bbb', os: 'os1', sha256: 'a'.repeat(64), size: 1234 });
    expect(parseManifest(manifest({ sha256: '../x' }))).toBeNull();
    expect(parseManifest(manifest({ size: '1234' }))).toBeNull();
    expect(parseManifest('not JSON')).toBeNull();
  });

  it('takes the app alone, changes over with no reboot, and keeps it when healthy', async () => {
    const { io, world } = appPi();
    const done = await run(io, false);
    expect(done?.result).toBe('installed');
    expect(world.fetched).toContain(`${APP}.json`);
    expect(world.fetched).toContain(`${APP}.json.sig`);
    expect(world.apps.fetched).toEqual([`${APP}.tar.gz`]);
    expect(world.installed).toEqual([]);
    expect(world.ran).toEqual([['/usr/bin/node', '/apps/dev+bbb/server/src/kiosk-update.ts', 'check'], ...RESTARTS]);
    expect(world.apps).toMatchObject({
      inUse: 'dev+bbb',
      previous: null,
      isTrial: false,
      over: { 'dev+bbb': 'dev+aaa' }
    });
    expect(world.apps.pruned).toEqual([['dev+bbb']]);
    expect(world.state.pending).toBeNull();
    expect(world.log).toContain('Restarting into the update.');
    expect(world.log.at(-1)).toBe('Kept dev+bbb.');
    await expect(check(io)).resolves.toMatchObject({ result: 'up-to-date', current: 'dev+bbb' });
  });

  it('installs the whole bundle when the OS differs, the release has no app alone, or it is not signed', async () => {
    for (const change of [
      (world: ReturnType<typeof pi>['world']) => (world.remote.manifest = manifest({ os: 'os2' })),
      (world: ReturnType<typeof pi>['world']) => (world.remote.manifest = manifest({ version: 'dev+ccc' })),
      (world: ReturnType<typeof pi>['world']) => (world.remote.manifest = null),
      (world: ReturnType<typeof pi>['world']) => (world.apps.isSigned = false)
    ]) {
      const { io, world } = appPi();
      change(world);
      // One Pi at a time.
      // eslint-disable-next-line no-await-in-loop
      await run(io, false);
      expect(world.installed).toEqual([DEV]);
      expect(world.apps.fetched).toEqual([]);
      expect(world.ran).toEqual([['tryboot']]);
    }
  });

  it('goes back to the app before it when the new one is not healthy, and never retries it', async () => {
    const { io, world } = appPi();
    world.wrong = 'The app has sent no heartbeat.';
    await run(io, false);
    expect(world.apps).toMatchObject({ inUse: null, previous: null, isTrial: false });
    expect(world.ran.slice(1)).toEqual([...RESTARTS, ...RESTARTS]);
    expect(world.state).toMatchObject({ pending: null, failed: ['dev+bbb'] });
    expect(world.log).toContain('Not healthy: The app has sent no heartbeat.');
    await expect(check(io)).resolves.toMatchObject({ result: 'failed', current: 'dev+aaa' });
  });

  it('goes back as well when the kiosk does not restart with the new app', async () => {
    const { io, world } = appPi();
    const realRun = io.run;
    let restarts = 0;
    io.run = argv => {
      const isKioskRestart = argv.join(' ') === '/usr/bin/systemctl restart kiosk.service';
      return isKioskRestart && restarts++ === 0
        ? Promise.reject(new Error('kiosk.service failed to start.'))
        : realRun(argv);
    };
    await run(io, false);
    expect(world.apps).toMatchObject({ inUse: null, isTrial: false });
    expect(world.state).toMatchObject({ pending: null, failed: ['dev+bbb'] });
    expect(world.log).toContain('Not healthy: kiosk.service failed to start.');
  });

  it('leaves a stable Pi’s app for the next restart', async () => {
    const { io, world } = appPi({ channel: 'stable' });
    world.remote.pointer = `${RELEASES}/download/v2/the-max-mix-v2.raucb`;
    world.remote.version = 'v2+bbb';
    world.remote.manifest = manifest({ version: 'v2+bbb' });
    await expect(run(io, false)).resolves.toMatchObject({ result: 'installed', installed: 'v2+bbb' });
    expect(world.apps.inUse).toBeNull();
    expect(world.state.pending).toEqual({ version: 'v2+bbb', slot: '', tried: false, over: 'dev+aaa' });
    await expect(check(io)).resolves.toMatchObject({ result: 'installed' });
    await restart(io);
    expect(world.apps.inUse).toBe('v2+bbb');
    expect(world.ran.slice(1)).toEqual(RESTARTS);
    expect(world.state.pending).toBeNull();
  });

  it('keeps the app before the one in use, for a rollback, and drops the older ones', async () => {
    const { io, world } = appPi();
    await run(io, false);
    world.remote.pointer = `${RELEASES}/download/dev/the-max-mix-ccc.raucb`;
    world.remote.version = 'dev+ccc';
    world.remote.manifest = manifest({ version: 'dev+ccc' });
    await run(io, false);
    expect(world.apps).toMatchObject({ inUse: 'dev+ccc', previous: 'dev+bbb' });
    expect(world.apps.pruned.at(-1)).toEqual(['dev+ccc', 'dev+bbb']);
    world.ran.length = 0;
    await rollback(io);
    expect(world.apps).toMatchObject({ inUse: 'dev+bbb', previous: null });
    expect(world.ran).toEqual(RESTARTS);
    expect(world.state.failed).toEqual(['dev+ccc']);
    await rollback(io);
    expect(world.apps.inUse).toBeNull();
    expect(world.state.failed).toEqual(['dev+ccc', 'dev+bbb']);
    expect(world.marks).toEqual([]);
  });

  it('goes back to the image’s own app with no download when the channel names the slot’s release', async () => {
    const { io, world } = appPi();
    await run(io, false);
    world.remote.pointer = `${RELEASES}/download/dev/the-max-mix-aaa.raucb`;
    world.remote.version = 'dev+aaa';
    world.remote.manifest = null;
    world.ran.length = 0;
    await run(io, false);
    expect(world.apps.inUse).toBeNull();
    expect(world.apps.fetched).toHaveLength(1);
    expect(world.installed).toEqual([]);
    expect(world.ran).toEqual(RESTARTS);
  });

  it('counts an app still on trial when the Pi went down as failed', async () => {
    const { io, world } = appPi({
      state: { pending: { version: 'dev+bbb', slot: '', tried: true, over: 'dev+aaa' } }
    });
    world.apps.isTrial = true;
    await expect(afterBoot(io)).resolves.toBe('normal');
    expect(world.apps.isTrial).toBe(false);
    expect(world.state).toMatchObject({ pending: null, failed: ['dev+bbb'] });
    expect(world.marks).toEqual([]);
  });

  it('leaves a waiting app alone at a boot, and drops one put over another slot', async () => {
    const pending = { version: 'dev+bbb', slot: '', tried: false, over: 'dev+aaa' };
    const { io, world } = appPi({ state: { pending } });
    await expect(afterBoot(io)).resolves.toBe('normal');
    expect(world.state.pending).toEqual(pending);
    world.files[RELEASE_ENV] = 'KIOSK_RELEASE_REF=dev\nKIOSK_RELEASE_COMMIT=zzz\nKIOSK_RELEASE_OS=os1\n';
    await expect(apply(io)).resolves.toBe('none');
    expect(world.state.pending).toBeNull();
    expect(world.apps.inUse).toBeNull();
  });

  it('does nothing while another updater runs', async () => {
    const { io, world } = appPi();
    world.apps.isLocked = true;
    await expect(run(io, false)).resolves.toBeNull();
    expect(world.apps.fetched).toEqual([]);
    expect(world.log).toEqual(['An update is already being installed.']);
  });
});
