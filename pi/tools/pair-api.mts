// Drives the kiosk-audio pairing API on the Pi the way the app's pairing sheet does, for checking a branch build before
// the app that goes with it is released: `node pair-api.mts` over SSH (no sudo). It starts looking for phones, prints
// what the Pi hears every 2 s, pairs with the number typed + Enter, and prints how pairing went and the saved phones.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SERVICE = 'http://127.0.0.1:7341';
const unit = readFileSync('/etc/systemd/user/kiosk-audio.service', 'utf8');
const origin = /KIOSK_APP_ORIGIN=(\S+)/.exec(unit)?.[1] ?? '';
if (!origin) throw new Error('No KIOSK_APP_ORIGIN in kiosk-audio.service');

type Fields = Record<string, unknown>;
const post = async (path: string, body?: unknown) => {
  const response = await fetch(`${SERVICE}${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  console.log(`POST ${path} -> ${response.status} ${text}`);
  return response.ok;
};
const report = async (): Promise<Fields> =>
  (await (await fetch(`${SERVICE}/bluetooth/monitor`, { headers: { Origin: origin } })).json()) as Fields;

if (!(await post('/bluetooth/pair-phone'))) process.exit(1);
console.log('Open Settings > Bluetooth on the phone. Type a number and Enter to pair; Ctrl+C stops.');
let nearby: { address: string; name: string }[] = [];
let last = '';
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const device = nearby[Number(line.trim()) - 1];
  if (device) void post('/bluetooth/pair-phone/pick', { address: device.address });
});
process.on('SIGINT', () => {
  void post('/bluetooth/pair-phone/stop').finally(() => process.exit(0));
});
for (;;) {
  const { pairing, phones } = (await report()) as { pairing: Fields; phones: unknown };
  if (pairing['state'] === 'scanning') {
    nearby = (pairing['nearby'] as { address: string; name: string }[] | undefined) ?? [];
    const shown = nearby.map((device, index) => `${index + 1}. ${device.name} (${device.address})`).join('\n');
    if (shown !== last) console.log(`\n--- ${String(pairing['secondsLeft'])} s left ---\n${shown || '(nothing named yet)'}`);
    last = shown;
  } else {
    const line = JSON.stringify(pairing);
    if (line !== last) console.log(line);
    last = line;
    if (pairing['state'] === 'paired' || pairing['state'] === 'failed' || pairing['state'] === 'idle') {
      console.log(`Saved phones: ${JSON.stringify(phones)}`);
      process.exit(pairing['state'] === 'paired' ? 0 : 1);
    }
  }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
