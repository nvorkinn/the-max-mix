// The updater on image Pis (image-update.ts), run as root:
//   node kiosk-update.ts run [--scheduled]   check, install anything newer, and on dev and branch Pis restart into it
//                                            (kiosk-update.service; the timer passes --scheduled)
//   node kiosk-update.ts check               print what the channel has, as JSON
//   node kiosk-update.ts apply               reboot into an installed update now, if one waits
//   node kiosk-update.ts restart             into an installed update when one waits, else restart the kiosk
//                                            (04:30, Restart)
//   node kiosk-update.ts rollback            go back to the other slot's version now (kiosk-rollback)
//   node kiosk-update.ts post-install        RAUC's post-install handler: points the new slot's cmdline.txt at its
//                                            own root partition, and writes the screen's video= and the Pi's own
//                                            config.txt lines (/data/the-max-mix/config.txt) into the slot
//   node kiosk-update.ts boot-config         write the Pi's own config.txt lines into the slot it runs from, after
//                                            they changed; they count from the next boot
import { mkdtemp, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readText, replaceFile, runProgram, updateIO } from './image-update-io.ts';
import {
  apply,
  check,
  cmdlineWithRoot,
  configWithOwn,
  installedBootDevice,
  installedRootLabel,
  KIOSK_ENV,
  OWN_CONFIG,
  parseEnv,
  restart,
  rollback,
  run
} from './image-update.ts';
import { raucOverDbus } from './rauc.ts';

const USAGE =
  'Usage: kiosk-update.ts run [--scheduled] | check | apply | restart | rollback | post-install | boot-config';
/** The boot partition of the slot the Pi runs from. */
const BOOTED_FIRMWARE = '/boot/firmware';

/**
 * Writes the Pi's own config.txt lines into the boot partition mounted at `folder`. Says whether it changed the file.
 * A Pi whose screen needs them shows nothing without them, and then fails the new slot's health check.
 */
async function didWriteOwnConfig(folder: string): Promise<boolean> {
  const file = path.join(folder, 'config.txt');
  const config = await readText(file);
  if (config === null) throw new Error(`${file} is missing.`);
  const next = configWithOwn(config, (await readText(OWN_CONFIG)) ?? '');
  if (next === config) return false;
  await replaceFile(file, next);
  return true;
}

/**
 * Points the boot slot RAUC just installed at its own root partition, and writes the screen's video= mode into it, so its
 * first boot already has it.
 */
async function postInstall(): Promise<void> {
  const device = installedBootDevice(process.env);
  if (!device) return;
  const videoMode = parseEnv((await readText(KIOSK_ENV)) ?? '')['KIOSK_VIDEO_MODE'];
  const mountPoint = await mkdtemp('/run/kiosk-update-boot-');
  await runProgram(['/usr/bin/mount', device, mountPoint]);
  try {
    const cmdline = path.join(mountPoint, 'cmdline.txt');
    const root = installedRootLabel(process.env);
    if (!root) throw new Error('RAUC wrote a boot slot without its root slot.');
    // Not caught: a slot that would boot the other slot's root must fail the install.
    await writeFile(cmdline, cmdlineWithRoot((await readText(cmdline)) ?? '', root));
  } catch (error) {
    await runProgram(['/usr/bin/umount', mountPoint]);
    await rmdir(mountPoint);
    throw error;
  }
  try {
    await didWriteOwnConfig(mountPoint);
  } catch (error) {
    console.warn(`Could not write the Pi's own config.txt lines into the new slot: ${String(error)}`);
  }
  try {
    // An empty --mode is the screen's own (EDID) mode; screen-mode.ts rewrites only the video= words.
    await runProgram([
      process.execPath,
      path.join(import.meta.dirname, 'screen-mode.ts'),
      '--cmdline',
      path.join(mountPoint, 'cmdline.txt'),
      '--mode',
      videoMode ?? ''
    ]);
  } catch (error) {
    // Most screens start without it; the kiosk's own start sets the mode again.
    console.warn(`Could not set the new slot's screen mode: ${String(error)}`);
  } finally {
    await runProgram(['/usr/bin/umount', mountPoint]);
    await rmdir(mountPoint);
  }
}

async function main(command: string | undefined, option: string | undefined): Promise<void> {
  if (command === 'post-install') {
    await postInstall();
    return;
  }
  if (command === 'boot-config') {
    const isChanged = await didWriteOwnConfig(BOOTED_FIRMWARE);
    console.log(
      isChanged ? `Wrote ${OWN_CONFIG} into this slot's config.txt. Reboot to use it.` : 'Nothing to change.'
    );
    return;
  }
  const rauc = await raucOverDbus();
  const io = updateIO(rauc);
  try {
    switch (command) {
      case 'run': {
        await run(io, option === '--scheduled');
        break;
      }
      case 'check': {
        console.log(JSON.stringify(await check(io), null, 2));
        break;
      }
      case 'apply': {
        if ((await apply(io)) === 'none') console.log('No installed update is waiting.');
        break;
      }
      case 'restart': {
        await restart(io);
        break;
      }
      case 'rollback': {
        await rollback(io);
        break;
      }
      default: {
        console.error(USAGE);
        process.exitCode = 2;
      }
    }
  } finally {
    await rauc.close();
  }
}

try {
  await main(process.argv[2], process.argv[3]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
