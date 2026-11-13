// The Bluetooth section of the app's debug console: what BlueZ says about the adapter and the devices it has paired, and
// a log of what changed, kept in memory. It watches BlueZ's objects on the system bus (dbus-native's live view of
// InterfacesAdded, InterfacesRemoved and PropertiesChanged), from the first time the app asks. It only listens: nothing
// here scans, pairs or advertises. Unpaired devices heard nearby are counted, and logged only while the console asks for
// them, since a house has dozens. This is the groundwork for recognising people's phones (paired once, then heard).

const ADAPTER = 'org.bluez.Adapter1';
const DEVICE = 'org.bluez.Device1';
const MAX_LOG = 200;
/** An unpaired device counts as nearby this long after it was last heard. */
export const NEARBY_MS = 60_000;
/** A paired device's signal is logged at most this often, an unpaired one's (when asked for) less often. */
const PAIRED_RSSI_LOG_MS = 10_000;
const NEARBY_RSSI_LOG_MS = 30_000;
const OPEN_TIMEOUT_MS = 5000;
/** The device properties whose changes are logged, as yes or no. */
const LOGGED_FLAGS = ['Paired', 'Bonded', 'Trusted', 'Connected', 'ServicesResolved', 'Blocked'];
/** The adapter properties whose changes are logged, and what the log calls them. */
const ADAPTER_FLAGS: Record<string, string> = {
  Powered: 'Powered',
  Discovering: 'Scanning',
  Discoverable: 'Discoverable',
  Pairable: 'Pairable'
};

export const UNAVAILABLE = 'Bluetooth is not available on this device.';

type Properties = Record<string, unknown>;

/** The part of dbus-native's ManagedObjects this uses; the tests pass a fake. */
export interface BluezView {
  filter: (interfaceName: string) => Record<string, Properties>;
  get: (path: string) => Record<string, Properties> | undefined;
  on(event: 'added', listener: (path: string, interfaces: Record<string, Properties>) => void): unknown;
  on(event: 'removed', listener: (path: string, interfaceNames: string[]) => void): unknown;
  on(
    event: 'changed',
    listener: (path: string, interfaceName: string, changed: Properties, invalidated: string[]) => void
  ): unknown;
  on(event: 'stale', listener: () => void): unknown;
}

/** A watched view, and how to stop watching it. */
interface Watched {
  view: BluezView;
  close: () => Promise<void>;
}

interface AdapterState {
  address: string;
  name: string;
  powered: boolean;
  discoverable: boolean;
  pairable: boolean;
  discovering: boolean;
}

interface KnownDevice {
  address: string;
  name: string;
  /** "public" or "random": a phone's own address is random, and changes unless it is paired. */
  addressType: string;
  /** BlueZ's guess of what it is: "phone", "audio-headphones", "computer"… or "". */
  icon: string;
  paired: boolean;
  bonded: boolean;
  trusted: boolean;
  connected: boolean;
  /** The last signal strength BlueZ reported (dBm), or null. */
  rssi: number | null;
  /** When it was last heard (ms since 1970), or null when not since the service started. */
  lastSeen: number | null;
}

export interface LogLine {
  /** Counts up from 1, for the app to tell lines apart. */
  id: number;
  time: number;
  message: string;
}

export interface MonitorSnapshot {
  adapter: AdapterState | null;
  /** The paired (or bonded) devices, connected ones first. */
  devices: KnownDevice[];
  /** How many unpaired devices were heard in the last NEARBY_MS. */
  nearby: number;
  /** Whether unpaired devices are logged too. */
  verbose: boolean;
  /** Oldest first, at most MAX_LOG lines. */
  log: LogLine[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isOn = (value: unknown): boolean => value === true;
const onOff = (value: unknown): string => (value === true ? 'on' : 'off');
const hasProperty = (properties: Properties, name: string): boolean => Object.hasOwn(properties, name);
/** Whether the change says the device was heard: BlueZ reports a signal strength only while it scans. */
const isHeard = (changed: Properties): boolean =>
  hasProperty(changed, 'RSSI') || hasProperty(changed, 'ManufacturerData');

function adapterState(properties: Properties): AdapterState {
  return {
    address: text(properties['Address']),
    name: text(properties['Alias']) || text(properties['Name']),
    powered: isOn(properties['Powered']),
    discoverable: isOn(properties['Discoverable']),
    pairable: isOn(properties['Pairable']),
    discovering: isOn(properties['Discovering'])
  };
}

const isPaired = (properties: Properties): boolean => isOn(properties['Paired']) || isOn(properties['Bonded']);
const deviceName = (properties: Properties): string =>
  text(properties['Alias']) || text(properties['Name']) || text(properties['Address']);
const label = (properties: Properties): string => `${deviceName(properties)} (${text(properties['Address'])})`;

function knownDevice(properties: Properties, lastSeen: number | null): KnownDevice {
  return {
    address: text(properties['Address']),
    name: deviceName(properties),
    addressType: text(properties['AddressType']) || 'public',
    icon: text(properties['Icon']),
    paired: isOn(properties['Paired']),
    bonded: isOn(properties['Bonded']),
    trusted: isOn(properties['Trusted']),
    connected: isOn(properties['Connected']),
    rssi: typeof properties['RSSI'] === 'number' ? properties['RSSI'] : null,
    lastSeen
  };
}

async function ignoreFailure(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // Already closed, or the bus went away: nothing is left to undo.
  }
}

/** Opens BlueZ's object tree on the system bus. */
async function openSystemBluez(): Promise<Watched> {
  const dbus = await import('dbus-native');
  const bus = dbus.systemBus();
  try {
    const view = await bus.objects('org.bluez', '/');
    return {
      view,
      close: async () => {
        await view.close();
        await bus.close();
      }
    };
  } catch (error) {
    await ignoreFailure(bus.close());
    throw error;
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('BlueZ did not answer.'));
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class BluetoothMonitor {
  private readonly open: () => Promise<Watched>;
  private readonly now: () => number;
  private watching: Promise<BluezView> | null = null;
  private readonly lines: LogLine[] = [];
  private isVerbose = false;
  private nextLine = 1;
  /** Last heard, by device path. */
  private readonly lastSeen = new Map<string, number>();
  /** When a device's signal was last logged, by path. */
  private readonly lastRssiLog = new Map<string, number>();
  /** Each device's name and address as last seen, to log its removal. */
  private readonly labels = new Map<string, { label: string; isPaired: boolean }>();

  constructor(options: { open?: () => Promise<Watched>; now?: () => number } = {}) {
    this.open = options.open ?? openSystemBluez;
    this.now = options.now ?? (() => Date.now());
  }

  private log(message: string): void {
    this.lines.push({ id: this.nextLine, time: this.now(), message });
    this.nextLine += 1;
    if (this.lines.length > MAX_LOG) this.lines.splice(0, this.lines.length - MAX_LOG);
  }

  /** Starts watching BlueZ (once; again after BlueZ restarts or the last attempt failed). */
  private watch(): Promise<BluezView> {
    this.watching ??= this.start();
    return this.watching;
  }

  private async start(): Promise<BluezView> {
    try {
      const { view, close } = await withTimeout(this.open(), OPEN_TIMEOUT_MS);
      this.follow(view, close);
      this.logStart(view);
      return view;
    } catch (error) {
      console.warn(`bluetooth monitor: ${String(error)}`);
      this.watching = null;
      throw error;
    }
  }

  private logStart(view: BluezView): void {
    const devices = Object.entries(view.filter(DEVICE));
    for (const [path, properties] of devices) {
      this.labels.set(path, { label: label(properties), isPaired: isPaired(properties) });
    }
    const paired = devices.filter(([, properties]) => isPaired(properties)).length;
    const adapter = Object.values(view.filter(ADAPTER))[0];
    this.log(
      adapter
        ? `Watching ${text(adapter['Address'])}: powered ${onOff(adapter['Powered'])}, ${paired} paired`
        : 'Watching BlueZ: no adapter'
    );
  }

  private follow(view: BluezView, close: () => Promise<void>): void {
    view.on('added', (path, interfaces) => {
      const adapter = interfaces[ADAPTER];
      if (adapter) this.log(`Adapter added: ${text(adapter['Address'])}`);
      const device = interfaces[DEVICE];
      if (device) this.deviceAdded(path, device);
    });
    view.on('removed', (path, interfaceNames) => {
      if (interfaceNames.includes(DEVICE)) this.deviceRemoved(path);
    });
    view.on('changed', (path, interfaceName, changed) => {
      if (interfaceName === ADAPTER) this.adapterChanged(changed);
      else if (interfaceName === DEVICE) this.deviceChanged(view.get(path)?.[DEVICE] ?? changed, path, changed);
    });
    view.on('stale', () => {
      this.log('BlueZ restarted; watching again');
      this.watching = null;
      void ignoreFailure(close());
    });
  }

  private deviceAdded(path: string, device: Properties): void {
    this.labels.set(path, { label: label(device), isPaired: isPaired(device) });
    if (isHeard(device)) this.lastSeen.set(path, this.now());
    if (isPaired(device)) this.log(`Paired device appeared: ${label(device)}`);
    else if (this.isVerbose) this.log(`Seen: ${label(device)}, ${text(device['AddressType']) || 'public'}`);
  }

  private deviceRemoved(path: string): void {
    const known = this.labels.get(path);
    this.labels.delete(path);
    this.lastSeen.delete(path);
    this.lastRssiLog.delete(path);
    if (known && (known.isPaired || this.isVerbose)) this.log(`Gone: ${known.label}`);
  }

  private adapterChanged(changed: Properties): void {
    for (const [property, name] of Object.entries(ADAPTER_FLAGS)) {
      if (hasProperty(changed, property)) this.log(`${name} ${onOff(changed[property])}`);
    }
  }

  /** `device` holds all of the device's properties, `changed` the ones that just changed. */
  private deviceChanged(device: Properties, path: string, changed: Properties): void {
    const isPairedNow = isPaired(device);
    this.labels.set(path, { label: label(device), isPaired: isPairedNow });
    if (isHeard(changed)) this.lastSeen.set(path, this.now());
    if (!isPairedNow && !this.isVerbose) return;
    for (const property of LOGGED_FLAGS) {
      if (hasProperty(changed, property)) {
        this.log(`${label(device)}: ${property} ${changed[property] === true ? 'yes' : 'no'}`);
      }
    }
    if (isHeard(changed)) this.logSignal(device, path, isPairedNow);
  }

  /** Logs that a device was heard, at most once per PAIRED_RSSI_LOG_MS (paired) or NEARBY_RSSI_LOG_MS. */
  private logSignal(device: Properties, path: string, isPairedNow: boolean): void {
    const last = this.lastRssiLog.get(path) ?? 0;
    if (this.now() - last < (isPairedNow ? PAIRED_RSSI_LOG_MS : NEARBY_RSSI_LOG_MS)) return;
    this.lastRssiLog.set(path, this.now());
    const rssi = typeof device['RSSI'] === 'number' ? `, ${device['RSSI']} dBm` : '';
    this.log(`Heard ${label(device)}${rssi}`);
  }

  setVerbose(isVerbose: boolean): void {
    if (isVerbose === this.isVerbose) return;
    this.isVerbose = isVerbose;
    this.log(isVerbose ? 'Logging unpaired devices too' : 'Logging paired devices only');
  }

  /** The adapter, the paired devices, the count of unpaired ones nearby and the log. Rejects when BlueZ is not there. */
  async snapshot(): Promise<MonitorSnapshot> {
    let view: BluezView;
    try {
      view = await this.watch();
    } catch {
      throw new Error(UNAVAILABLE);
    }
    const devices: KnownDevice[] = [];
    let nearby = 0;
    const known = Object.entries(view.filter(DEVICE));
    for (const [path, properties] of known) {
      const seen = this.lastSeen.get(path) ?? null;
      if (isPaired(properties)) devices.push(knownDevice(properties, seen));
      else if (seen !== null && this.now() - seen < NEARBY_MS) nearby += 1;
    }
    const adapter = Object.values(view.filter(ADAPTER))[0];
    return {
      adapter: adapter ? adapterState(adapter) : null,
      devices: devices.toSorted((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name)),
      nearby,
      verbose: this.isVerbose,
      log: [...this.lines]
    };
  }
}
