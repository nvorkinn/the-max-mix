// Saves a PNG of what a kiosk's touchscreen shows, from your computer: `npm run kiosk-screenshot -- [host] [file.png]`.
// The host defaults to the-max-mix.local (the admin account's SSH login, so a Tailscale name works too) and the file to
// kiosk-<host>-<time>.png. The kiosk's Chromium listens for DevTools on 127.0.0.1 only (kiosk_devtools_port in the
// Ansible role), so this opens an SSH tunnel to it, asks the page for a screenshot over the DevTools protocol and closes
// the tunnel. While a tunnel is open (`ssh -N -L 9222:127.0.0.1:9222 admin@<host>`), chrome://inspect on your computer
// can inspect the page too.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

const KIOSK_PORT = 9222;
const host = process.argv[2] ?? 'the-max-mix.local';
const file =
  process.argv[3] ?? `kiosk-${host.split('.', 1)[0] ?? host}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.png`;

/** A free port on this computer for the tunnel's near end. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('No free port'));
      });
    });
  });
}

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/** The page on screen: Chromium's page targets, leaving out DevTools' own. */
async function findScreenTarget(base: string): Promise<Target> {
  const response = await fetch(`${base}/json/list`);
  const targets = (await response.json()) as Target[];
  const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl && /^https?:/.test(t.url));
  if (!page) throw new Error(`No page target: ${JSON.stringify(targets.map(t => [t.type, t.url]))}`);
  return page;
}

/** findScreenTarget, tried for up to 15 s: the tunnel takes a moment to come up after ssh starts. */
async function screenTarget(base: string, triesLeft = 30): Promise<Target> {
  try {
    return await findScreenTarget(base);
  } catch (error) {
    if (triesLeft <= 1) throw error;
    await new Promise(resolve => setTimeout(resolve, 500));
    return screenTarget(base, triesLeft - 1);
  }
}

async function captureScreenshot(webSocketUrl: string): Promise<Buffer> {
  const socket = new WebSocket(webSocketUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('The kiosk did not answer within 15 s'));
    }, 15_000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as { id?: number; result?: { data: string }; error?: { message: string } };
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.result) resolve(Buffer.from(message.result.data, 'base64'));
      else reject(new Error(message.error?.message ?? 'No screenshot in the answer'));
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('The DevTools connection failed'));
    });
  });
}

const localPort = await freePort();
// The ssh on your PATH, with your own SSH config and keys.
const tunnel = spawn(
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  'ssh',
  ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `${localPort}:127.0.0.1:${KIOSK_PORT}`, `admin@${host}`],
  { stdio: ['ignore', 'inherit', 'inherit'] }
);
const tunnelClosed = new Promise<never>((_, reject) =>
  tunnel.once('exit', code => {
    reject(new Error(`ssh to admin@${host} ended (exit ${code})`));
  })
);

try {
  const base = `http://127.0.0.1:${localPort}`;
  const target = await Promise.race([screenTarget(base), tunnelClosed]);
  // DevTools names the socket by the address it was asked on; the tunnel's end is the one this computer can reach.
  const webSocketUrl = `ws://127.0.0.1:${localPort}${new URL(target.webSocketDebuggerUrl ?? '').pathname}`;
  const png = await Promise.race([captureScreenshot(webSocketUrl), tunnelClosed]);
  writeFileSync(file, png);
  console.log(`Saved ${file} (${target.url})`);
} catch (error) {
  console.error(`kiosk-screenshot: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  tunnel.removeAllListeners('exit');
  tunnel.kill();
}
