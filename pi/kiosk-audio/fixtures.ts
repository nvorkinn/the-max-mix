// A pw-dump reply for the tests: the local output (40), two AirPlay speakers (50, 60) and Chromium (70) playing to the
// local output, with a level meter (90) also listening to Chromium.
import { vi } from 'vitest';

export const KITCHEN = 'raop_sink.Kitchen.local.192.168.1.20.7000';
export const LOUNGE = 'raop_sink.Lounge.local.192.168.1.21.7000';

const node = (id: number, name: string, mediaClass: string, props: Record<string, unknown> = {}) => ({
  id,
  type: 'PipeWire:Interface:Node',
  info: { props: { 'node.name': name, 'media.class': mediaClass, ...props } }
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
    node(50, KITCHEN, 'Audio/Sink', { 'node.description': 'Kitchen', 'raop.hostname': 'Kitchen.local' }),
    port(51, 50, 'input', 'FL'),
    port(52, 50, 'input', 'FR'),
    node(60, LOUNGE, 'Audio/Sink', { 'node.description': 'lounge' }),
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
