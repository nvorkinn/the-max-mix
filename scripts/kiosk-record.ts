// Saves an MP4 of what a kiosk's touchscreen shows, from your computer:
// `npm run kiosk-record -- [host] [seconds] [file.mp4]`. The host defaults to the-max-mix.local (the admin account's
// SSH login, so a Tailscale name works too), the seconds to 10 (at most 120) and the file to kiosk-<host>-<time>.mp4.
// It runs `sudo kiosk-record` on the kiosk over SSH, which has wf-recorder record the screen from Cage, so it shows the
// whole screen whatever app Cage runs, and saves the MP4 that comes back.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const host = process.argv[2] ?? 'the-max-mix.local';
const seconds = process.argv[3] ?? '10';
const file =
  process.argv[4] ?? `kiosk-${host.split('.', 1)[0] ?? host}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.mp4`;

/** The MP4 from the kiosk's own kiosk-record, over the ssh on your PATH with your own SSH config and keys. */
async function record(): Promise<Buffer> {
  if (!/^\d+$/.test(seconds) || Number(seconds) < 1 || Number(seconds) > 120) {
    throw new Error(`record for 1 to 120 seconds, not ${seconds}`);
  }
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const ssh = spawn('ssh', [`admin@${host}`, 'sudo', '/usr/local/sbin/kiosk-record', seconds], {
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const chunks: Buffer[] = [];
  ssh.stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  // Recording, encoding again with libx264 if the hardware encoder fails, and sending the file back.
  const timer = setTimeout(() => ssh.kill(), (Number(seconds) * 2 + 60) * 1000);
  return new Promise((resolve, reject) => {
    ssh.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    ssh.once('close', code => {
      clearTimeout(timer);
      const mp4 = Buffer.concat(chunks);
      // An MP4 starts with its ftyp box: a 4-byte size, then "ftyp".
      if (code === 0 && mp4.toString('latin1', 4, 8) === 'ftyp') resolve(mp4);
      else reject(new Error(`ssh admin@${host} sudo kiosk-record ended (exit ${code}) without an MP4`));
    });
  });
}

console.log(`Recording ${host} for ${seconds} s…`);
try {
  writeFileSync(file, await record());
  console.log(`Saved ${file}`);
} catch (error) {
  console.error(`kiosk-record: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
