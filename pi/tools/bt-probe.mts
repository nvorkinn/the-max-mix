// A throwaway probe for the Pi, run over SSH: `sudo node bt-probe.mts pick` or `sudo node bt-probe.mts watch`.
// It records what BlueZ really does, so pairing and presence changes can be checked on the Pi before any PR.
//
// pick:  scans Classic and LE, lists devices nearby with their names as they come in, and on a number + Enter freezes
//        that device's name and address, pairs with it (this probe's agent says yes and prints any code to compare),
//        then reports what BlueZ ends up with: the address after pairing, and which keys the bond holds.
// watch: scans LE for 8 s every 30 s, like presence.ts, and prints when each paired device was last heard.
//
// Every BlueZ change goes to ~/bt-probe-<time>.jsonl. dbus-native comes from the installed kiosk-audio
// (KIOSK_AUDIO_DIR, default /opt/the-max-mix/kiosk-audio). Stop kiosk-audio pairing first; presence can keep running.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const kioskAudio = process.env['KIOSK_AUDIO_DIR'] ?? '/opt/the-max-mix/kiosk-audio';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbus: any = createRequire(path.join(kioskAudio, 'package.json'))('dbus-native');

const ADAPTER = '/org/bluez/hci0';
const AGENT = '/org/themaxmix/probe_agent';
const DEVICE = 'org.bluez.Device1';
const mode = process.argv[2] ?? 'pick';
const started = new Date().toISOString().replaceAll(/[:.]/g, '-');
const logFile = path.join(process.env['SUDO_USER'] ? `/home/${process.env['SUDO_USER']}` : homedir(), `bt-probe-${started}.jsonl`);

type Properties = Record<string, unknown>;

const record = (event: string, data: Record<string, unknown>): void => {
  appendFileSync(logFile, `${JSON.stringify({ time: new Date().toISOString(), event, ...data })}\n`);
};
const say = (line: string): void => {
  console.log(line);
  record('note', { line });
};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const bus = dbus.systemBus();
while (!bus.name) await sleep(10);

const call = (objectPath: string, iface: string, member: string, args: { signature?: string; body?: unknown[] } = {}, timeout?: number) =>
  bus.invoke({ destination: 'org.bluez', path: objectPath, interface: iface, member, ...args }, timeout ? { timeout } : undefined);
const quietly = async (work: PromiseLike<unknown>) => {
  try {
    await work;
  } catch {
    // Nothing to undo.
  }
};

const view = await bus.objects('org.bluez', '/');
const lastHeard = new Map<string, number>();
const devices = (): Record<string, Properties> => view.filter(DEVICE);
const adapterAddress = text(view.get(ADAPTER)?.['org.bluez.Adapter1']?.['Address']);

record('start', { mode, adapterAddress, devices: devices(), adapter: view.get(ADAPTER) });
view.on('added', (objectPath: string, interfaces: Record<string, Properties>) => {
  if (interfaces[DEVICE]) {
    lastHeard.set(objectPath, Date.now());
    record('added', { path: objectPath, properties: interfaces[DEVICE] });
  }
});
view.on('removed', (objectPath: string, names: string[]) => record('removed', { path: objectPath, interfaces: names }));
view.on('changed', (objectPath: string, iface: string, changed: Properties, invalidated: string[]) => {
  if (iface !== DEVICE && iface !== 'org.bluez.Adapter1') return;
  if ('RSSI' in changed || 'ManufacturerData' in changed) lastHeard.set(objectPath, Date.now());
  // Signal strength alone is noisy: keep it out of the log unless something else changed too.
  const keys = Object.keys(changed).filter(key => key !== 'RSSI');
  if (keys.length > 0 || mode === 'watch') record('changed', { path: objectPath, iface, changed, invalidated });
  if ('Name' in changed || 'Alias' in changed || 'Address' in changed || 'Paired' in changed || 'Bonded' in changed) {
    console.log(`  ${objectPath}: ${JSON.stringify(Object.fromEntries(keys.map(key => [key, changed[key]])))}`);
  }
});

/** The section names (never the keys) of each bond BlueZ stored for this adapter. Needs root. */
function bonds(): Record<string, string[]> {
  const dir = `/var/lib/bluetooth/${adapterAddress}`;
  const found: Record<string, string[]> = {};
  try {
    for (const entry of readdirSync(dir)) {
      if (!/^([\dA-F]{2}:){5}[\dA-F]{2}$/.test(entry)) continue;
      try {
        const info = readFileSync(path.join(dir, entry, 'info'), 'utf8');
        const name = /^Name=(.*)$/m.exec(info)?.[1] ?? '';
        found[entry] = [`Name=${name}`, ...[...info.matchAll(/^\[(.+)\]$/gm)].map(match => match[1] ?? '')];
      } catch {
        // No info file: not bonded.
      }
    }
  } catch (error) {
    found['error'] = [`${String(error)} (run with sudo to read bonds)`];
  }
  return found;
}

async function scan(transport: string): Promise<void> {
  await call(ADAPTER, 'org.bluez.Adapter1', 'SetDiscoveryFilter', {
    signature: 'a{sv}',
    body: [{ Transport: new dbus.Variant('s', transport), DuplicateData: new dbus.Variant('b', true) }]
  });
  await call(ADAPTER, 'org.bluez.Adapter1', 'StartDiscovery');
}
const stopScan = () => quietly(call(ADAPTER, 'org.bluez.Adapter1', 'StopDiscovery'));

async function registerAgent(): Promise<void> {
  const nothing = (): null => null;
  const agent = dbus.defineInterface({
    name: 'org.bluez.Agent1',
    methods: {
      Release: nothing,
      RequestConfirmation: {
        in: { device: 'o', passkey: 'u' },
        handler: (device: string, passkey: number) => {
          say(`Agent: confirming code ${String(passkey).padStart(6, '0')} for ${device} (check it matches the phone)`);
          return null;
        }
      },
      RequestAuthorization: { in: { device: 'o' }, handler: (device: string) => (say(`Agent: authorising ${device}`), null) },
      AuthorizeService: { in: { device: 'o', uuid: 's' }, handler: (device: string, uuid: string) => (say(`Agent: service ${uuid} for ${device}`), null) },
      RequestPinCode: { in: { device: 'o' }, out: { pinCode: 's' }, handler: () => (say('Agent: PIN asked, answering 0000'), '0000') },
      RequestPasskey: { in: { device: 'o' }, out: { passkey: 'u' }, handler: () => (say('Agent: passkey asked, answering 0'), 0) },
      DisplayPinCode: { in: { device: 'o', pinCode: 's' }, handler: (_device: string, pin: string) => (say(`Agent: PIN ${pin}`), null) },
      DisplayPasskey: { in: { device: 'o', passkey: 'u', entered: 'q' }, handler: (_device: string, passkey: number) => (say(`Agent: passkey ${passkey}`), null) },
      Cancel: () => (say('Agent: cancelled'), null)
    }
  });
  await bus.export(AGENT, agent);
  await call('/org/bluez', 'org.bluez.AgentManager1', 'RegisterAgent', { signature: 'os', body: [AGENT, 'KeyboardDisplay'] });
  await call('/org/bluez', 'org.bluez.AgentManager1', 'RequestDefaultAgent', { signature: 'o', body: [AGENT] });
}

const finish = async (code = 0): Promise<never> => {
  await stopScan();
  await quietly(call('/org/bluez', 'org.bluez.AgentManager1', 'UnregisterAgent', { signature: 'o', body: [AGENT] }));
  say(`Log: ${logFile}`);
  await quietly(view.close());
  await quietly(bus.close());
  process.exit(code);
};
process.on('SIGINT', () => void finish());

const row = (props: Properties) =>
  `${text(props['Name']) || '-'} | alias ${text(props['Alias'])} | ${text(props['Address'])} (${text(props['AddressType']) || 'public'})` +
  ` | ${'Class' in props ? 'classic' : 'le'} | ${text(props['Icon']) || '-'} | ${typeof props['RSSI'] === 'number' ? `${props['RSSI']} dBm` : ''}`;

async function pick(): Promise<void> {
  await registerAgent();
  await scan('auto');
  say('Scanning Classic and LE. Open Settings > Bluetooth on the phone. Type a number and Enter to pair; Ctrl+C quits.');
  let shown: [string, Properties][] = [];
  const draw = () => {
    const now = Date.now();
    shown = Object.entries(devices())
      .filter(([objectPath, props]) => !props['Paired'] && now - (lastHeard.get(objectPath) ?? 0) < 30_000)
      .sort(([, a], [, b]) => Number(b['RSSI'] ?? -999) - Number(a['RSSI'] ?? -999))
      .slice(0, 25);
    console.log(`\n--- ${new Date().toLocaleTimeString()} ---`);
    for (const [index, [, props]] of shown.entries()) console.log(`${String(index + 1).padStart(2)}. ${row(props)}`);
  };
  const timer = setInterval(draw, 3000);
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const choice = shown[Number(line.trim()) - 1];
    if (!choice) continue;
    clearInterval(timer);
    lines.close();
    const [objectPath, props] = choice;
    const frozen = { path: objectPath, name: text(props['Name']), alias: text(props['Alias']), address: text(props['Address']), addressType: text(props['AddressType']) };
    record('picked', frozen);
    say(`Picked and froze: ${row(props)}`);
    const before = bonds();
    await stopScan();
    say('Pairing… accept on the phone.');
    try {
      await call(objectPath, DEVICE, 'Pair', {}, 90_000);
      say('Pair() returned OK.');
    } catch (error) {
      say(`Pair() failed: ${String((error as { dbusName?: string }).dbusName ?? error)}`);
    }
    say('Waiting 15 s for keys and names to settle…');
    await sleep(15_000);
    const after = view.get(objectPath)?.[DEVICE] ?? {};
    const result = {
      frozenName: frozen.name || frozen.alias,
      addressAtTap: `${frozen.address} (${frozen.addressType})`,
      addressNow: `${text(after['Address'])} (${text(after['AddressType'])})`,
      nameNow: text(after['Name']),
      paired: after['Paired'],
      bonded: after['Bonded'],
      connected: after['Connected'],
      bondsBefore: before,
      bondsAfter: bonds()
    };
    record('result', result);
    console.log(JSON.stringify(result, null, 2));
    say('An [IdentityResolvingKey] in bondsAfter means presence can recognise this phone later. Next: `sudo node bt-probe.mts watch`.');
    await quietly(call(objectPath, DEVICE, 'Disconnect'));
    await finish();
  }
}

async function watch(): Promise<void> {
  say('Every 30 s: LE scan for 8 s, then when each paired device was last heard. Ctrl+C quits.');
  for (;;) {
    await quietly(scan('le'));
    await sleep(8000);
    await stopScan();
    const now = Date.now();
    console.log(`\n--- ${new Date().toLocaleTimeString()} ---`);
    for (const [objectPath, props] of Object.entries(devices())) {
      if (!props['Paired'] && !props['Bonded']) continue;
      const heard = lastHeard.get(objectPath);
      const line = `${row(props)} | ${props['Connected'] ? 'connected | ' : ''}${heard ? `heard ${Math.round((now - heard) / 1000)} s ago` : 'not heard'}`;
      console.log(line);
      record('presence', { path: objectPath, address: props['Address'], name: props['Name'], heardAgoMs: heard ? now - heard : null });
    }
    await sleep(22_000);
  }
}

say(`bt-probe ${mode}, adapter ${adapterAddress}, logging to ${logFile}`);
if (mode === 'watch') await watch();
else if (mode === 'pick') await pick();
else {
  console.error('usage: sudo node bt-probe.mts pick|watch');
  await finish(2);
}
