// Saves a PNG of what a kiosk's touchscreen shows, from your computer: `npm run kiosk-screenshot -- [host] [file.png]`.
// The host defaults to the-max-mix.local (the admin account's SSH login, so a Tailscale name works too) and the file to
// kiosk-<host>-<time>.png. It runs `sudo kiosk-screenshot` on the kiosk over SSH, which has grim take the screen from
// Cage, so it shows the whole screen whatever app Cage runs, and saves the PNG that comes back.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const host = process.argv[2] ?? 'the-max-mix.local';
const file =
  process.argv[3] ?? `kiosk-${host.split('.', 1)[0] ?? host}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.png`;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The PNG from the kiosk's own kiosk-screenshot, over the ssh on your PATH with your own SSH config and keys. */
async function screenshot(): Promise<Buffer> {
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const ssh = spawn('ssh', [`admin@${host}`, 'sudo', '/usr/local/sbin/kiosk-screenshot'], {
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const chunks: Buffer[] = [];
  ssh.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  const timer = setTimeout(() => ssh.kill(), 30_000);
  return new Promise((resolve, reject) => {
    ssh.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    ssh.once('close', code => {
      clearTimeout(timer);
      const png = Buffer.concat(chunks);
      if (code === 0 && png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) resolve(png);
      else reject(new Error(`ssh admin@${host} sudo kiosk-screenshot ended (exit ${code}) without a PNG`));
    });
  });
}

try {
  writeFileSync(file, await screenshot());
  console.log(`Saved ${file}`);
} catch (error) {
  console.error(`kiosk-screenshot: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
