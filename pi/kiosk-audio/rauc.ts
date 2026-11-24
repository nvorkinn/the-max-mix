// RAUC, the A/B updater on image Pis, over its D-Bus API (de.pengutronix.rauc.Installer on the system bus). The updater
// (image-update.ts) and the health check use it: what slot is booted, what a bundle on GitHub holds, installing one into
// the other slot with its progress, and marking a slot good, bad or active. A D-Bus policy in the image
// (the-max-mix-rauc.conf) lets the kiosk user ask too, so kiosk-audio can check for updates from the screen.
import type { MessageBus } from 'dbus-native';
import { ignoreFailure, untilConnected } from './system-bus.ts';

const SERVICE = 'de.pengutronix.rauc';
const INSTALLER = 'de.pengutronix.rauc.Installer';
const PROPERTIES = 'org.freedesktop.DBus.Properties';
/** Inspecting a bundle on GitHub reads its signature and manifest over a few range requests. */
const INSPECT_TIMEOUT_MS = 60_000;

/** One slot as RAUC reports it (GetSlotStatus), with only what the updater reads. */
export interface Slot {
  /** RAUC's name for it: rootfs.0, boot.1 and so on. */
  name: string;
  class: string;
  /** a or b, on the root slots (system.conf). */
  bootname: string | null;
  /** booted, active or inactive. */
  state: string;
  /** The version of the bundle last installed into it, if RAUC installed one. */
  bundleVersion: string | null;
}

/** RAUC's progress: how far, in percent, and what it is doing. */
export interface Progress {
  percent: number;
  message: string;
}

export interface Rauc {
  /** The bootname of the slot the Pi runs from. */
  bootSlot: () => Promise<string>;
  /** idle, or installing. */
  operation: () => Promise<string>;
  slots: () => Promise<Slot[]>;
  /** The version in a bundle's manifest; null when it has none. Reads only the manifest, even from a URL. */
  inspect: (source: string) => Promise<string | null>;
  /** Installs a bundle into the other slot, streaming it from `source`; resolves when it is in, rejects with RAUC's error. */
  install: (source: string, onProgress: (progress: Progress) => void) => Promise<void>;
  /** `rauc status mark-good|mark-bad|mark-active booted|other`. */
  mark: (state: 'good' | 'bad' | 'active', slot: 'booted' | 'other') => Promise<void>;
  close: () => Promise<void>;
}

type Plain = Record<string, unknown>;

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** A slot from GetSlotStatus's (name, properties) pair. */
export function toSlot(name: string, properties: Plain): Slot {
  return {
    name,
    class: text(properties['class']) ?? name.split('.')[0] ?? '',
    bootname: text(properties['bootname']),
    state: text(properties['state']) ?? '',
    bundleVersion: text(properties['bundle.version'])
  };
}

/** The version in InspectBundle's answer (`update.version`), or in the older flat shape. */
export function inspectedVersion(info: Plain): string | null {
  const update = info['update'];
  if (typeof update === 'object' && update !== null && 'version' in update) return text(update.version);
  return text(info['version']);
}

/** RAUC's Progress property, (percentage, message, depth). */
export function toProgress(value: unknown): Progress | null {
  if (!Array.isArray(value)) return null;
  const [percent, message] = value as unknown[];
  return typeof percent === 'number' ? { percent, message: typeof message === 'string' ? message : '' } : null;
}

/** RAUC on the system bus. `given` is the bus; the tests pass a fake. */
export async function raucOverDbus(given?: MessageBus): Promise<Rauc> {
  const dbus = await import('dbus-native');
  const bus = given ?? dbus.systemBus();
  await untilConnected(bus);
  const call = <T>(member: string, signature?: string, body: unknown[] = [], timeout?: number) =>
    bus.invoke<T>(
      {
        destination: SERVICE,
        path: '/',
        interface: INSTALLER,
        member,
        ...(signature === undefined ? {} : { signature, body })
      },
      timeout === undefined ? undefined : { timeout }
    );
  const property = async (name: string): Promise<unknown> =>
    dbus.toPlain(
      await bus.invoke({
        destination: SERVICE,
        path: '/',
        interface: PROPERTIES,
        member: 'Get',
        signature: 'ss',
        body: [INSTALLER, name]
      })
    );

  return {
    bootSlot: async () => String(await property('BootSlot')),
    operation: async () => String(await property('Operation')),
    slots: async () => {
      const status = dbus.toPlain<[string, Plain][]>(await call('GetSlotStatus'));
      return status.map(([name, properties]) => toSlot(name, properties));
    },
    inspect: async source =>
      inspectedVersion(dbus.toPlain<Plain>(await call('InspectBundle', 'sa{sv}', [source, {}], INSPECT_TIMEOUT_MS))),
    install: async (source, onProgress) => {
      const installer = await bus.proxy(SERVICE, '/', { interface: INSTALLER });
      const properties = await bus.proxy(SERVICE, '/', { interface: PROPERTIES });
      let finish: (code: number) => void = () => {};
      const completed = new Promise<number>(resolve => {
        finish = resolve;
      });
      const watches = [
        await installer.$watch('Completed', (code: number) => {
          finish(code);
        }),
        await properties.$watch('PropertiesChanged', (iface: string, changed: Plain) => {
          const progress = iface === INSTALLER ? toProgress(dbus.toPlain(changed['Progress'])) : null;
          if (progress) onProgress(progress);
        })
      ];
      try {
        await call('InstallBundle', 'sa{sv}', [source, {}]);
        if ((await completed) !== 0) {
          throw new Error(text(await property('LastError')) ?? 'RAUC could not install the update.');
        }
      } finally {
        await Promise.all(watches.map(watch => ignoreFailure(watch.remove())));
      }
    },
    mark: async (state, slot) => {
      await call('Mark', 'ss', [state, slot]);
    },
    close: () => ignoreFailure(bus.close())
  };
}
