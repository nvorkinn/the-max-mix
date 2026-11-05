// A pw-dump reply for the tests: the local output (40), two AirPlay speakers (50, 60) and Chromium (70) playing to the
// local output, with a level meter (90) also listening to Chromium. Kitchen's volume is 40% (0.064 = 0.4 cubed); Lounge
// reports none.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { vi } from 'vitest';

const node = (id: number, name: string, mediaClass: string, props: Record<string, unknown> = {}, params?: unknown) => ({
  id,
  type: 'PipeWire:Interface:Node',
  info: { props: { 'node.name': name, 'media.class': mediaClass, ...props }, ...(params !== undefined && { params }) }
});

const port = (id: number, nodeId: number, direction: string, channel: string, isMonitor = false) => ({
  id,
  type: 'PipeWire:Interface:Port',
  info: { direction, props: { 'node.id': nodeId, 'audio.channel': channel, 'port.monitor': isMonitor } }
});

export const link = (id: number, outputPort: number, inputPort: number) => ({
  id,
  type: 'PipeWire:Interface:Link',
  info: { 'output-port-id': outputPort, 'input-port-id': inputPort }
});

export function dump(extra: unknown[] = [], links?: unknown[]): string {
  return JSON.stringify([
    {
      id: 30,
      type: 'PipeWire:Interface:Metadata',
      props: { 'metadata.name': 'default' },
      metadata: [
        { subject: 0, key: 'default.audio.sink', type: 'Spa:String:JSON', value: { name: 'alsa_output.hdmi' } }
      ]
    },
    node(40, 'alsa_output.hdmi', 'Audio/Sink', { 'node.description': 'Built-in Audio' }),
    port(41, 40, 'input', 'FL'),
    port(42, 40, 'input', 'FR'),
    port(43, 40, 'output', 'FL', true),
    node(
      50,
      'raop_sink.Kitchen.local.7000',
      'Audio/Sink',
      { 'node.description': 'Kitchen', 'raop.hostname': 'Kitchen.local' },
      { Props: [{ volume: 1, mute: false, channelVolumes: [0.064, 0.064] }] }
    ),
    port(51, 50, 'input', 'FL'),
    port(52, 50, 'input', 'FR'),
    node(60, 'raop_sink.Lounge.local.7000', 'Audio/Sink', { 'node.description': 'Lounge' }),
    port(61, 60, 'input', 'FL'),
    port(62, 60, 'input', 'FR'),
    node(70, 'Chromium', 'Stream/Output/Audio', {
      'application.name': 'Chromium',
      'application.process.binary': 'chromium'
    }),
    port(71, 70, 'output', 'FL'),
    port(72, 70, 'output', 'FR'),
    node(90, 'pavucontrol peak', 'Stream/Input/Audio'),
    port(91, 90, 'input', 'MONO'),
    { id: 99, type: 'PipeWire:Interface:Node', info: null },
    'junk',
    ...extra,
    ...(links ?? [link(80, 71, 41), link(81, 72, 42), link(82, 71, 91)])
  ]);
}

/** Keeps the service's log lines out of the test output. */
export function silence(...methods: ('info' | 'warn' | 'debug')[]): void {
  for (const method of methods) {
    vi.spyOn(console, method).mockImplementation(() => {
      // Silenced.
    });
  }
}

/** The bytes a phone writes to send the kiosk a Wi-Fi network, built from the Improv protocol's description. */
export function wifiPacket(ssid: string, password: string): Uint8Array {
  const text = new TextEncoder();
  const data = [ssid, password].flatMap(part => [text.encode(part).length, ...text.encode(part)]);
  const body = [1, data.length, ...data];
  return Uint8Array.from([...body, body.reduce((sum, byte) => (sum + byte) % 256, 0)]);
}

// eslint-disable-next-line sonarjs/no-hardcoded-ip -- the hotspot's own address: a request over the hotspot, unless a test says otherwise
const HOTSPOT_SIDE = '10.42.0.1';

/** A request and a response for a handler under test, without a socket: `localAddress` is where the request came in. */
export function exchange(
  method: string,
  url: string,
  options: { body?: unknown; localAddress?: string; origin?: string } = {}
) {
  const sentBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  const body = options.body === undefined ? [] : [Buffer.from(sentBody)];
  const request = Object.assign(Readable.from(body), {
    method,
    url,
    headers: options.origin ? { origin: options.origin } : {},
    socket: { localAddress: options.localAddress ?? HOTSPOT_SIDE }
  }) as unknown as IncomingMessage;
  const sent: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const response = {
    setHeader: vi.fn(),
    writeHead(status: number, headers?: Record<string, string>) {
      sent.status = status;
      if (headers) sent.headers = headers;
      return response;
    },
    end(text = '') {
      sent.body = text;
      return response;
    }
  };
  return { request, response: response as unknown as ServerResponse, sent };
}
