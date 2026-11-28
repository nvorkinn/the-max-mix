// A throwaway probe: can a Sonos group play what this tablet plays, while Spotify Soloist stays the playing device?
// It runs ON the Pi, as the kiosk user (it needs that user's PipeWire session), with the Pi's own Node:
//
//   sudo -u kiosk XDG_RUNTIME_DIR=/run/user/$(id -u kiosk) node sonos-stream-probe.mts <command> [args]
//
//   rooms                 Lists the Sonos rooms (name, address, group coordinator).
//   serve [port]          Adds a PipeWire sink, links Soloist's output into it as well, and serves that sound as an
//                         endless WAV at http://<pi>:<port>/stream.wav (default port 7350) until Ctrl+C, which takes the
//                         sink and links away again. Logs each connection and how much it sent.
//   play <room> [flac|wav] Takes the room out of its group, sets it to 5% and plays the stream on it (default FLAC).
//   clip [seconds]       Records that many seconds (default 20) to a finished FLAC file, served at /clip.flac;
//                         `play <room> clip` plays it.
//   join <room> <to>      Adds the room to the group <to> leads, at 5%.
//   stop <room>           Stops the room's group and takes it back out of any group.
//
// It never sets a Sonos above 5%. Results go in this thread's notes, not in the repository.
import { spawn, spawnSync } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';

const SINK = 'maxmix_sonos_probe';
const RATE = 44_100;
const CHANNELS = 2;
const VOLUME = 5;

interface Room {
  name: string;
  host: string;
  uuid: string;
  coordinator: string;
}

const xmlEscape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function soap(host: string, path: string, service: string, action: string, args: string): Promise<string> {
  const body =
    '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:1">${args}</u:${action}></s:Body></s:Envelope>`;
  const response = await fetch(`http://${host}:1400${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'text/xml; charset="utf-8"',
      soapaction: `"urn:schemas-upnp-org:service:${service}:1#${action}"`
    },
    body
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${action} on ${host}: HTTP ${response.status} ${text.slice(0, 400)}`);
  return text;
}

const avTransport = (host: string, action: string, args = '') =>
  soap(host, '/MediaRenderer/AVTransport/Control', 'AVTransport', action, `<InstanceID>0</InstanceID>${args}`);

/** Finds one Sonos speaker by SSDP, then reads every room from its zone group state. */
async function rooms(): Promise<Room[]> {
  const host = await new Promise<string>((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('No Sonos answered SSDP in 4 s'));
    }, 4000);
    socket.on('message', (message, remote) => {
      if (!message.toString().includes('Sonos')) return;
      clearTimeout(timer);
      socket.close();
      resolve(remote.address);
    });
    socket.bind(() => {
      const search = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 1',
        'ST: urn:schemas-upnp-org:device:ZonePlayer:1',
        '',
        ''
      ].join('\r\n');
      socket.send(search, 1900, '239.255.255.250');
    });
  });
  const reply = await soap(host, '/ZoneGroupTopology/Control', 'ZoneGroupTopology', 'GetZoneGroupState', '');
  const state = reply
    .replace(/^[\s\S]*<ZoneGroupState>/, '')
    .replace(/<\/ZoneGroupState>[\s\S]*$/, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
  const found: Room[] = [];
  for (const group of state.matchAll(/<ZoneGroup Coordinator="([^"]+)"[^>]*>([\s\S]*?)<\/ZoneGroup>/g)) {
    const [, coordinator = '', members = ''] = group;
    for (const member of members.matchAll(/<ZoneGroupMember ([^>]*?)\/?>/g)) {
      const attrs = Object.fromEntries([...(member[1] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
      if (attrs['Invisible'] === '1') continue;
      const location = /http:\/\/([\d.]+):1400/.exec(attrs['Location'] ?? '');
      if (!location?.[1] || !attrs['UUID'] || !attrs['ZoneName']) continue;
      found.push({ name: attrs['ZoneName'], host: location[1], uuid: attrs['UUID'], coordinator });
    }
  }
  return found;
}

async function room(name: string): Promise<Room> {
  const all = await rooms();
  const match = all.find(entry => entry.name.toLowerCase() === name.toLowerCase());
  if (!match) throw new Error(`No room "${name}"; rooms: ${all.map(entry => entry.name).join(', ')}`);
  return match;
}

/** The Pi's address on the home network, as the Sonos will reach it. */
function piAddress(): string {
  if (process.env['PI_IP']) return process.env['PI_IP'];
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter(entry => entry && entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('100.'));
  const address = candidates[0]?.address;
  if (!address) throw new Error('No home network address; set PI_IP');
  return address;
}

const setVolume = (host: string) =>
  soap(
    host,
    '/MediaRenderer/RenderingControl/Control',
    'RenderingControl',
    'SetVolume',
    `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${VOLUME}</DesiredVolume>`
  );

// pw-link can wait for a link to start, which never happens while both nodes sleep, so every call has a time limit.
const run = (argv: string[]) => {
  const result = spawnSync(argv[0] ?? '', argv.slice(1), { encoding: 'utf8', timeout: 3000 });
  return { code: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
};

/** Soloist's output ports (FL, FR), from pw-link's list of output ports. */
function soloistPorts(): string[] {
  const dump = JSON.parse(run(['pw-dump']).out) as {
    id: number;
    type: string;
    info?: { props?: Record<string, unknown> };
  }[];
  // Only Soloist's client names the binary; its node carries the client's id (and node.name "spotify").
  const clients = new Set(
    dump
      .filter(
        entry =>
          entry.type === 'PipeWire:Interface:Client' &&
          String(entry.info?.props?.['application.process.binary'] ?? '').includes('soloist')
      )
      .map(entry => entry.id)
  );
  const nodes = dump.filter(
    entry =>
      entry.type === 'PipeWire:Interface:Node' &&
      (clients.has(Number(entry.info?.props?.['client.id'])) || entry.info?.props?.['node.name'] === 'spotify')
  );
  const names = new Set(nodes.map(node => String(node.info?.props?.['node.name'])));
  return run(['pw-link', '--output'])
    .out.split('\n')
    .filter(port => names.has(port.split(':')[0] ?? ''));
}

function wavHeader(): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(0xff_ff_ff_ff - 8, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * CHANNELS * 2, 28);
  header.writeUInt16LE(CHANNELS * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(0xff_ff_ff_ff - 44, 40);
  return header;
}

// FLAC, the format AirConnect sends Sonos: verbatim (uncompressed) frames of BLOCK samples, which need no encoder.
const BLOCK = 4096;
const CLIP = '/tmp/maxmix-clip.flac';

function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80_00 ? ((crc << 1) ^ 0x80_05) & 0xff_ff : (crc << 1) & 0xff_ff;
  }
  return crc;
}

/** FLAC's UTF-8-like coding of the frame number. */
function codedNumber(value: number): number[] {
  if (value < 0x80) return [value];
  const limits = [0x8_00, 0x1_00_00, 0x20_00_00, 0x4_00_00_00];
  const below = limits.findIndex(limit => value < limit);
  const count = below === -1 ? 6 : below + 2;
  const bytes = [((0xff << (8 - count)) & 0xff) | Math.floor(value / 2 ** (6 * (count - 1)))];
  for (let k = count - 2; k >= 0; k -= 1) bytes.push(0x80 | (Math.floor(value / 2 ** (6 * k)) & 0x3f));
  return bytes;
}

function flacHeader(totalSamples = 0): Buffer {
  const info = Buffer.alloc(4 + 4 + 34);
  info.write('fLaC', 0);
  info.writeUInt8(0x80, 4); // last metadata block, STREAMINFO
  info.writeUIntBE(34, 5, 3);
  info.writeUInt16BE(BLOCK, 8);
  info.writeUInt16BE(BLOCK, 10);
  // min/max frame size unknown (0); then 20 bits rate, 3 bits channels-1, 5 bits bps-1, 36 bits total samples (0).
  const packed = (BigInt(RATE) << 44n) | (BigInt(CHANNELS - 1) << 41n) | (15n << 36n) | BigInt(totalSamples);
  info.writeBigUInt64BE(packed, 18);
  return info;
}

/** One frame of BLOCK interleaved s16le stereo samples. */
function flacFrame(pcm: Buffer, index: number): Buffer {
  const head = Buffer.from([0xff, 0xf8, 0xc9, 0x18, ...codedNumber(index)]);
  const frame = Buffer.alloc(head.length + 1 + CHANNELS * (1 + BLOCK * 2) + 2);
  head.copy(frame);
  frame[head.length] = crc8(head);
  let at = head.length + 1;
  for (let channel = 0; channel < CHANNELS; channel += 1) {
    frame[at] = 0x02; // VERBATIM subframe, no wasted bits
    at += 1;
    for (let sample = 0; sample < BLOCK; sample += 1) {
      frame.writeInt16BE(pcm.readInt16LE((sample * CHANNELS + channel) * 2), at);
      at += 2;
    }
  }
  frame.writeUInt16BE(crc16(frame.subarray(0, at)), at);
  return frame;
}

function serve(port: number): void {
  run(['pw-cli', 'destroy', SINK]); // one left by an earlier run
  const made = run([
    'pw-cli',
    'create-node',
    'adapter',
    `{ factory.name=support.null-audio-sink node.name=${SINK} node.description="Sonos probe" media.class=Audio/Sink ` +
      `audio.position=[FL FR] audio.rate=${RATE} object.linger=true }`
  ]);
  console.log(`sink: ${made.out || 'created'}`);
  const linkSoloist = () => {
    const ports = soloistPorts();
    const existing = run(['pw-link', '--links']).out;
    // Each "|->" line under a port is one of its links; only those under ours matter here.
    for (const out of ports) {
      const side = out.endsWith('FL') ? 'FL' : 'FR';
      const input = `${SINK}:playback_${side}`;
      if (existing.includes(input)) continue;
      const linked = run(['pw-link', out, input]);
      if (linked.out.includes('File exists')) continue;
      console.log(`link ${out} -> ${input}: ${linked.code === 0 ? 'made' : linked.out || 'timed out (made once it plays)'}`);
    }
    return ports.length;
  };
  const server = createServer((request, response) => {
    const from = request.socket.remoteAddress;
    console.log(`${new Date().toISOString()} ${request.method} ${request.url} from ${from} ${request.headers['user-agent']}`);
    if (request.url?.startsWith('/clip.flac') && existsSync(CLIP)) {
      // A finished file, with its length, and byte ranges as Sonos asks for them.
      const file = readFileSync(CLIP);
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
      const first = range ? Number(range[1]) : 0;
      const last = range?.[2] ? Number(range[2]) : file.length - 1;
      const headers = {
        'content-type': 'audio/flac',
        'accept-ranges': 'bytes',
        'content-length': String(last - first + 1),
        ...(range && { 'content-range': `bytes ${first}-${last}/${file.length}` })
      };
      response.writeHead(range ? 206 : 200, headers);
      response.end(request.method === 'HEAD' ? undefined : file.subarray(first, last + 1));
      return;
    }
    const flac = request.url?.startsWith('/stream.flac') ?? false;
    if (!flac && !request.url?.startsWith('/stream.wav')) {
      response.writeHead(404).end();
      return;
    }
    const type = flac ? 'audio/flac' : 'audio/wav';
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', connection: 'close' });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.write(flac ? flacHeader() : wavHeader());
    let pending = Buffer.alloc(0);
    let frames = 0;
    const recorder = spawn('pw-record', [
      '--target',
      SINK,
      '-P',
      '{ stream.capture.sink=true }',
      '--rate',
      String(RATE),
      '--channels',
      String(CHANNELS),
      '--format',
      's16',
      '--latency',
      '20ms',
      '-'
    ]);
    let sent = 0;
    const started = Date.now();
    recorder.stdout.on('data', (chunk: Buffer) => {
      sent += chunk.length;
      if (!flac) {
        response.write(chunk);
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      const size = BLOCK * CHANNELS * 2;
      while (pending.length >= size) {
        response.write(flacFrame(pending.subarray(0, size), frames));
        frames += 1;
        pending = pending.subarray(size);
      }
    });
    recorder.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    const report = setInterval(() => {
      const seconds = (Date.now() - started) / 1000;
      const audio = sent / (RATE * CHANNELS * 2);
      console.log(`  ${from}: ${seconds.toFixed(0)} s connected, ${audio.toFixed(1)} s of audio sent`);
    }, 10_000);
    request.socket.on('close', () => {
      clearInterval(report);
      recorder.kill();
      console.log(`${new Date().toISOString()} closed ${from} after ${(sent / (RATE * CHANNELS * 2)).toFixed(1)} s`);
    });
  });
  server.listen(port, '0.0.0.0', () => console.log(`serving http://${piAddress()}:${port}/stream.flac (and /stream.wav)`));
  if (linkSoloist() === 0) console.log('Soloist has no output yet; it is linked once it plays (checked every 2 s)');
  const relink = setInterval(linkSoloist, 2000);


  const cleanup = () => {
    clearInterval(relink);
    server.close();
    console.log(run(['pw-cli', 'destroy', SINK]).out || 'sink removed');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

/** Records `seconds` of what Soloist plays into a finished FLAC file, CLIP, which serve then offers at /clip.flac. */
async function clip(seconds: number): Promise<void> {
  const recorder = spawn('pw-record', [
    '--target', SINK, '-P', '{ stream.capture.sink=true }', '--rate', String(RATE), '--channels', String(CHANNELS),
    '--format', 's16', '-'
  ]);
  const chunks: Buffer[] = [];
  recorder.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  recorder.kill();
  const pcm = Buffer.concat(chunks);
  const size = BLOCK * CHANNELS * 2;
  const frames = Math.floor(pcm.length / size);
  const parts = [flacHeader(frames * BLOCK)];
  for (let index = 0; index < frames; index += 1) parts.push(flacFrame(pcm.subarray(index * size, (index + 1) * size), index));
  writeFileSync(CLIP, Buffer.concat(parts));
  let peak = 0;
  for (let at = 0; at + 1 < pcm.length; at += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(at)));
  console.log(`${CLIP}: ${((frames * BLOCK) / RATE).toFixed(1)} s, peak ${peak}`);
}

async function play(name: string, port: number, format: string): Promise<void> {
  const target = await room(name);
  if (target.coordinator !== target.uuid) await avTransport(target.host, 'BecomeCoordinatorOfStandaloneGroup');
  await setVolume(target.host);
  const url = `http://${piAddress()}:${port}/${format === 'clip' ? 'clip.flac' : `stream.${format}`}`;
  const didl =
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
    'xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">' +
    '<item id="maxmix" parentID="0" restricted="true"><dc:title>The Max Mix</dc:title>' +
    `<upnp:class>object.item.audioItem.${format === 'clip' ? 'musicTrack' : 'audioBroadcast'}</upnp:class>` +
    `<res protocolInfo="http-get:*:audio/${format === 'wav' ? 'wav' : 'flac'}:*">${xmlEscape(url)}</res></item></DIDL-Lite>`;
  await avTransport(
    target.host,
    'SetAVTransportURI',
    `<CurrentURI>${xmlEscape(url)}</CurrentURI><CurrentURIMetaData>${xmlEscape(didl)}</CurrentURIMetaData>`
  );
  await avTransport(target.host, 'Play', '<Speed>1</Speed>');
  console.log(`${new Date().toISOString()} ${target.name} (${target.host}) told to play ${url} at ${VOLUME}%`);
  for (let read = 0; read < 5; read += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 2000));
    // eslint-disable-next-line no-await-in-loop
    const info = await avTransport(target.host, 'GetTransportInfo');
    console.log(`  state: ${/<CurrentTransportState>(\w+)</.exec(info)?.[1]}`);
  }
}

async function join(name: string, to: string): Promise<void> {
  const [member, leader] = await Promise.all([room(name), room(to)]);
  await setVolume(member.host);
  await avTransport(
    member.host,
    'SetAVTransportURI',
    `<CurrentURI>x-rincon:${leader.uuid}</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>`
  );
  console.log(`${member.name} joined ${leader.name} at ${VOLUME}%`);
}

async function stop(name: string): Promise<void> {
  const target = await room(name);
  const all = await rooms();
  const coordinator = all.find(entry => entry.uuid === target.coordinator) ?? target;
  await avTransport(coordinator.host, 'Stop');
  if (target.coordinator !== target.uuid) await avTransport(target.host, 'BecomeCoordinatorOfStandaloneGroup');
  console.log(`${target.name} stopped`);
}

const [command, first, second] = process.argv.slice(2);
const port = (value: string | undefined) => Number(value ?? 7350);
switch (command) {
  case 'rooms': {
    for (const entry of await rooms()) {
      console.log(`${entry.name}\t${entry.host}\t${entry.coordinator === entry.uuid ? 'leads' : 'member'}`);
    }
    break;
  }
  case 'serve': {
    serve(port(first));
    break;
  }
  case 'play': {
    await play(first ?? '', port(undefined), second === 'wav' || second === 'clip' ? second : 'flac');
    break;
  }
  case 'clip': {
    await clip(Number(first ?? 20));
    break;
  }
  case 'join': {
    await join(first ?? '', second ?? '');
    break;
  }
  case 'stop': {
    await stop(first ?? '');
    break;
  }
  default: {
    console.log('commands: rooms | serve [port] | play <room> [flac|wav|clip] | clip [s] | join <room> <to> | stop <room>');
  }
}
