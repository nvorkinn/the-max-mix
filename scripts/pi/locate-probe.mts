// Tests whether a kiosk can find its own postcode from the Wi-Fi around it: `sudo node locate-probe.mts [postcode]
// [--max N]` on a Pi that is already online. It starts its own scan (setup by QR code never lists networks), asks
// BeaconDB where those access points are, and prints the six nearest postcodes, which are what the setup wizard would
// offer. With the Pi's real postcode it also says whether that one is among the six.
// Two requests are sent: one with only what nmcli reports (what kiosk-server could do as the kiosk user), and one with
// the kernel's own readings from `iw` (real dBm and age), to see whether the better data changes the answer.
// Nearby networks' MAC addresses and names go to BeaconDB, and the position it answers goes to postcodes.io.
import { spawnSync } from 'node:child_process';

const BEACONDB = 'https://api.beacondb.net/v1/geolocate';
const POSTCODES = 'https://api.postcodes.io/postcodes';
const HEADERS = { 'User-Agent': 'THE MAX MIX (https://github.com/nvorkinn/the-max-mix)' };
const SETUP_HOTSPOT = 'THE MAX MIX setup';
const CANDIDATES = 6;
const TIMEOUT_MS = 10_000;

interface AccessPoint {
  macAddress: string;
  ssid: string;
  frequency: number;
  channel: number;
  signalStrength: number;
  age?: number;
}
interface Position {
  lat: number;
  lng: number;
  accuracy: number;
}
interface Place {
  postcode: string;
  latitude: number;
  longitude: number;
}

const run = (file: string, args: string[]): string | null => {
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    env: { LC_ALL: 'C', PATH: '/usr/sbin:/usr/bin:/sbin:/bin' }
  });
  if (result.status === 0) return result.stdout;
  console.log(`${file} ${args.slice(0, 4).join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  return null;
};

/** Splits one line of `nmcli -t` output on unescaped colons, as server/src/nmcli.ts does. */
function splitTerse(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (char === '\\' && index + 1 < line.length) {
      index += 1;
      current += line.charAt(index);
    } else if (char === ':') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function channelOf(frequency: number): number {
  if (frequency === 2484) return 14;
  if (frequency < 2484) return (frequency - 2407) / 5;
  if (frequency < 5950) return (frequency - 5000) / 5;
  return (frequency - 5950) / 5;
}

/** nmcli's rows, one per access point. Its signal is a percentage; NetworkManager maps -100..-50 dBm onto 0..100. */
function scanWithNmcli(): AccessPoint[] {
  const output = run('nmcli', ['-t', '-f', 'BSSID,SSID,CHAN,FREQ,SIGNAL', 'device', 'wifi', 'list', '--rescan', 'yes']);
  const found: AccessPoint[] = [];
  for (const line of (output ?? '').split('\n')) {
    const [bssid, ssid, chan, freq, signal] = splitTerse(line);
    if (!bssid || signal === undefined) continue;
    found.push({
      macAddress: bssid.toLowerCase(),
      ssid: ssid ?? '',
      channel: Number(chan),
      frequency: Number.parseInt(freq ?? '', 10),
      signalStrength: Math.round(Number(signal) / 2 - 100)
    });
  }
  return found;
}

/** The kernel's cached scan results, which the nmcli scan has just refreshed. */
function readWithIw(): AccessPoint[] | null {
  const devices = run('nmcli', ['-t', '-f', 'DEVICE,TYPE', 'device']) ?? '';
  const device = devices
    .split('\n')
    .map(splitTerse)
    .find(fields => fields[1] === 'wifi')?.[0];
  if (!device) return null;
  const output = run('iw', ['dev', device, 'scan', 'dump']);
  if (output === null) return null;
  const found: AccessPoint[] = [];
  for (const block of output.split(/^BSS /m).slice(1)) {
    const field = (pattern: RegExp) => pattern.exec(block)?.[1];
    const frequency = Math.round(Number(field(/^\s+freq: ([\d.]+)/m)));
    const signal = field(/^\s+signal: (-?[\d.]+) dBm/m);
    const age = field(/^\s+last seen: (\d+) ms ago/m);
    if (!frequency || signal === undefined) continue;
    found.push({
      macAddress: block.slice(0, 17).toLowerCase(),
      ssid: field(/^\s+SSID: (.*)$/m) ?? '',
      frequency,
      channel: channelOf(frequency),
      signalStrength: Math.round(Number(signal)),
      ...(age === undefined ? {} : { age: Number(age) })
    });
  }
  return found;
}

/** Hidden networks and those that opt out with `_nomap` must not be sent; the kiosk's own hotspot says nothing. */
const usable = (points: AccessPoint[], max: number): AccessPoint[] =>
  points
    .filter(point => point.ssid !== '' && !point.ssid.startsWith('\\x00') && !point.ssid.endsWith('_nomap'))
    .filter(point => point.ssid !== SETUP_HOTSPOT)
    .sort((a, b) => b.signalStrength - a.signalStrength)
    .slice(0, max);

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    headers: { ...HEADERS, ...init?.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

async function locate(points: AccessPoint[]): Promise<Position | null> {
  const { status, body } = await getJson(BEACONDB, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wifiAccessPoints: points,
      considerIp: false,
      fallbacks: { lacf: false, ipf: false }
    })
  });
  const answer = body as { location?: { lat: number; lng: number }; accuracy?: number; fallback?: string };
  if (status !== 200 || !answer.location) {
    console.log(`  BeaconDB answered ${status}: ${JSON.stringify(body).slice(0, 300)}`);
    return null;
  }
  if (answer.fallback) console.log(`  (BeaconDB fell back to "${answer.fallback}", so this is not a Wi-Fi position)`);
  return { ...answer.location, accuracy: answer.accuracy ?? Number.NaN };
}

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const h =
    Math.sin(radians(b.lat - a.lat) / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

const spaceless = (postcode: string) => postcode.replace(/\s+/g, '').toUpperCase();

async function report(label: string, points: AccessPoint[], home: Place | null, wanted: string): Promise<void> {
  console.log(`\n== ${label}: ${points.length} access points sent ==`);
  if (points.length < 2) {
    console.log('  BeaconDB needs at least two.');
    return;
  }
  const position = await locate(points);
  if (!position) return;
  console.log(`  Position: ${position.lat}, ${position.lng}, accurate to ${Math.round(position.accuracy)} m`);
  console.log(
    `  Map: https://www.openstreetmap.org/?mlat=${position.lat}&mlon=${position.lng}#map=18/${position.lat}/${position.lng}`
  );
  if (home) {
    const off = metresBetween(position, { lat: home.latitude, lng: home.longitude });
    console.log(`  ${Math.round(off)} m from the centre of ${home.postcode}`);
  }
  const radius = Math.min(2000, Math.max(200, Math.round(position.accuracy) || 200));
  const { status, body } = await getJson(
    `${POSTCODES}?lon=${position.lng}&lat=${position.lat}&limit=${CANDIDATES}&radius=${radius}`
  );
  const places = (body as { result?: (Place & { distance: number })[] | null }).result ?? [];
  if (status !== 200 || places.length === 0) {
    console.log(`  No postcodes within ${radius} m (postcodes.io answered ${status}).`);
    return;
  }
  console.log(`  Nearest postcodes (within ${radius} m):`);
  places.forEach((place, index) => {
    const mark = wanted && spaceless(place.postcode) === wanted ? '  <-- the real one' : '';
    console.log(`    ${index + 1}. ${place.postcode.padEnd(8)} ${Math.round(place.distance)} m${mark}`);
  });
  if (wanted && !places.some(place => spaceless(place.postcode) === wanted))
    console.log(`  The real postcode is NOT among these ${places.length}.`);
}

const args = process.argv.slice(2);
const maxAt = args.indexOf('--max');
const max = maxAt === -1 ? Number.POSITIVE_INFINITY : Number(args[maxAt + 1]);
const typed = args.filter((_, index) => maxAt === -1 || (index !== maxAt && index !== maxAt + 1)).join(' ');
const wanted = spaceless(typed);

let home: Place | null = null;
if (wanted) {
  const { status, body } = await getJson(`${POSTCODES}/${encodeURIComponent(wanted)}`);
  home = status === 200 ? ((body as { result: Place }).result ?? null) : null;
  if (!home) console.log(`postcodes.io does not know "${typed}" (${status}); carrying on without it.`);
}

const started = Date.now();
const fromNmcli = scanWithNmcli();
console.log(`nmcli scan: ${fromNmcli.length} access points in ${((Date.now() - started) / 1000).toFixed(1)} s`);
const fromIw = readWithIw();
if (fromIw) console.log(`iw scan dump: ${fromIw.length} access points`);
else console.log('iw is not available (or not run with sudo), so only the nmcli request is sent.');

const sent = usable(fromNmcli, max);
console.log('\nStrongest networks sent (nmcli):');
for (const point of sent.slice(0, 15))
  console.log(
    `  ${point.macAddress}  ${String(point.signalStrength).padStart(4)} dBm  ch ${String(point.channel).padStart(3)}  ${point.ssid}`
  );

await report('nmcli only', sent, home, wanted);
if (fromIw) await report('iw (real dBm and age)', usable(fromIw, max), home, wanted);
