// Wi-Fi setup from any phone, with no app: the kiosk makes its own Wi-Fi network for a few minutes (NetworkManager's
// hotspot, which also runs the DHCP and DNS the phone needs), the tablet shows a QR code that joins it, and the phone
// then gets a page (hotspot-portal.ts) to choose its Wi-Fi and type the password on its own keyboard. The Pi has one
// Wi-Fi radio, so the hotspot replaces whatever network it was on while it is up: the networks in range are scanned
// first, and the earlier network comes back when the hotspot ends without a new one being joined.
import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlePortalRequest, refusePortalRequest } from './hotspot-portal.ts';
import type { Portal } from './hotspot-portal.ts';
import { runCommand } from './nmcli.ts';
import type { ConnectRequest, ConnectResult, Network, Run } from './nmcli.ts';
import { qrRows, wifiQrText } from './qr.ts';

export const HOTSPOT_SSID = 'THE MAX MIX setup';
const CONNECTION = 'kiosk-setup';
// What NetworkManager gives a hotspot's own address, unless it says otherwise.
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- NetworkManager's own default for a hotspot
const DEFAULT_ADDRESS = '10.42.0.1';
// No 0, O, 1, I or L: the password is read off a screen when the QR code cannot be scanned.
// cspell:disable-next-line
const PASSWORD_CHARACTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PASSWORD_LENGTH = 10;
const LIFETIME_MS = 10 * 60 * 1000;
/** After the phone has been answered, so its reply arrives before the hotspot it came over goes away. */
const JOIN_DELAY_MS = 1500;
const COMMAND_TIMEOUT_MS = 30_000;

type HotspotState = 'idle' | 'running' | 'joining' | 'failed';

export interface HotspotStatus {
  state: HotspotState;
  /** Why the last attempt to join failed, for the tablet to show. */
  error?: string;
}

/** What the tablet shows: how to join the hotspot, and where its page is, as text and as QR codes (rows of 0 and 1). */
export interface HotspotInfo {
  ssid: string;
  password: string;
  url: string;
  wifiQr: string[];
  urlQr: string[];
}

/** Thrown with a message that is safe to show on the tablet. */
export class HotspotError extends Error {
  override name = 'HotspotError';
}

export interface HotspotOptions {
  /** The networks in range (the kiosk's scan), asked before the hotspot takes the radio. */
  scan: () => Promise<Network[]>;
  /** Joins a network, as the setup page's Connect does. */
  connect: (request: ConnectRequest) => Promise<ConnectResult>;
  /** Closes the setup page. */
  done: () => void;
  run?: Run;
  /** Makes the service's HTTP server accept connections on the hotspot's address. */
  listen: (host: string) => Promise<Portal>;
  lifetimeMs?: number;
  joinDelayMs?: number;
  /** A random whole number below `max`, for the password. */
  random?: (max: number) => number;
}

/** A password for the hotspot: easy to read off a screen, random for every hotspot. */
export function makePassword(random: (max: number) => number = randomInt): string {
  return Array.from({ length: PASSWORD_LENGTH }, () => PASSWORD_CHARACTERS[random(PASSWORD_CHARACTERS.length)]).join(
    ''
  );
}

/** The first Wi-Fi device in `nmcli -t -f DEVICE,TYPE device` output, or null. */
export function wifiDevice(output: string): string | null {
  for (const line of output.split('\n')) {
    const [device, type] = line.trim().split(':', 2);
    if (device && type === 'wifi') return device;
  }
  return null;
}

/** The address in `nmcli -g IP4.ADDRESS device show` output (`10.42.0.1/24`), or null. */
export function addressOf(output: string): string | null {
  const [address] = output.trim().split('\n', 1)[0]?.split('/') ?? [];
  const parts = address?.split('.') ?? [];
  const isAddress = parts.length === 4 && parts.every(part => String(Number(part)) === part && Number(part) <= 255);
  return isAddress ? (address ?? null) : null;
}

/** The UUID of the Wi-Fi connection that is active, from `nmcli -t -f UUID,TYPE,NAME connection show --active`. */
export function activeWifiUuid(output: string): string | null {
  for (const line of output.split('\n')) {
    const [uuid, type, name] = line.trim().split(':', 3);
    if (uuid && type === '802-11-wireless' && name !== CONNECTION) return uuid;
  }
  return null;
}

export class Hotspot {
  private readonly options: HotspotOptions;
  private readonly run: Run;
  private info: HotspotInfo | undefined;
  private portal: Portal | undefined;
  private networks: Network[] = [];
  private previous: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private starting: Promise<HotspotInfo> | undefined;
  private current: HotspotStatus = { state: 'idle' };

  constructor(options: HotspotOptions) {
    this.options = options;
    this.run = options.run ?? runCommand;
  }

  private nmcli(args: string[]): ReturnType<Run> {
    return this.run(['nmcli', ...args], '', COMMAND_TIMEOUT_MS);
  }

  /** The networks in range, or none when the scan fails: the hotspot is still worth starting. */
  private async scanQuietly(): Promise<Network[]> {
    try {
      return await this.options.scan();
    } catch {
      return [];
    }
  }

  /** Joins the network; a connection that throws is a failed join. */
  private async connectQuietly(request: ConnectRequest): Promise<ConnectResult> {
    try {
      return await this.options.connect(request);
    } catch {
      return { ok: false, error: 'Could not connect.' };
    }
  }

  private async begin(): Promise<HotspotInfo> {
    this.networks = await this.scanQuietly();
    const devices = await this.nmcli(['-t', '-f', 'DEVICE,TYPE', 'device']);
    const device = wifiDevice(devices.stdout);
    if (!device) throw new HotspotError('There is no Wi-Fi adapter to make a hotspot with.');
    const active = await this.nmcli(['-t', '-f', 'UUID,TYPE,NAME', 'connection', 'show', '--active']);
    this.previous = activeWifiUuid(active.stdout);

    const password = makePassword(this.options.random);
    await this.nmcli(['connection', 'delete', 'id', CONNECTION]);
    // The password is on the command line for a moment: it is random, lasts minutes, and is shown on the screen anyway.
    const made = await this.nmcli([
      'device',
      'wifi',
      'hotspot',
      'ifname',
      device,
      'con-name',
      CONNECTION,
      'ssid',
      HOTSPOT_SSID,
      'band',
      'bg',
      'password',
      password
    ]);
    if (made.code !== 0) {
      await this.takeDown();
      throw new HotspotError('The hotspot could not be started.');
    }
    const shown = await this.nmcli(['-g', 'IP4.ADDRESS', 'device', 'show', device]);
    const host = addressOf(shown.stdout) ?? DEFAULT_ADDRESS;
    try {
      this.portal = await this.options.listen(host);
    } catch (error) {
      await this.takeDown();
      throw new HotspotError('The setup page could not be started.', { cause: error });
    }
    const url = this.portal.port === 80 ? `http://${host}/` : `http://${host}:${this.portal.port}/`;
    this.info = {
      ssid: HOTSPOT_SSID,
      password,
      url,
      wifiQr: await qrRows(wifiQrText(HOTSPOT_SSID, password)),
      urlQr: await qrRows(url)
    };
    this.current = { state: 'running' };
    this.timer = setTimeout(() => void this.stop(), this.options.lifetimeMs ?? LIFETIME_MS);
    return this.info;
  }

  /** Closes the portal and removes the hotspot, so the radio is free again. */
  private async takeDown(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.info = undefined;
    const portal = this.portal;
    this.portal = undefined;
    try {
      await portal?.close();
    } catch {
      // Already closed.
    }
    await this.nmcli(['connection', 'down', 'id', CONNECTION]);
    await this.nmcli(['connection', 'delete', 'id', CONNECTION]);
  }

  private async restorePrevious(): Promise<void> {
    if (this.previous) await this.nmcli(['connection', 'up', 'uuid', this.previous]);
  }

  /** The phone chose a network: leave the hotspot (after its answer got out) and join it. */
  private joinNetwork(request: ConnectRequest): void {
    if (this.current.state !== 'running') return;
    this.current = { state: 'joining' };
    setTimeout(() => {
      void (async () => {
        await this.takeDown();
        const result = await this.connectQuietly(request);
        if (result.ok) {
          this.current = { state: 'idle' };
          this.options.done();
        } else {
          await this.restorePrevious();
          this.current = { state: 'failed', error: `Could not join ${request.ssid}: ${result.error}` };
        }
      })();
    }, this.options.joinDelayMs ?? JOIN_DELAY_MS);
  }

  /** Starts the hotspot and its page, or returns how to join the one that is up. Rejects with a HotspotError. */
  async start(): Promise<HotspotInfo> {
    if (this.current.state === 'joining') throw new HotspotError('The kiosk is joining a network. Wait a moment.');
    if (this.info) return this.info;
    const pending = (this.starting ??= this.begin());
    try {
      return await pending;
    } finally {
      if (this.starting === pending) this.starting = undefined;
    }
  }

  /** Ends the hotspot, and puts back the network the kiosk was on. */
  async stop(): Promise<void> {
    if (this.current.state === 'joining') return;
    const wasRunning = this.info !== undefined || this.portal !== undefined;
    await this.takeDown();
    if (wasRunning) await this.restorePrevious();
    this.current = { state: 'idle' };
  }

  /** Answers a request that came in over the hotspot (the service hands those here, and nothing else reaches the phone). */
  async handlePortal(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.current.state !== 'running') {
      refusePortalRequest(response);
      return;
    }
    await handlePortalRequest(request, response, {
      networks: () => this.networks,
      onJoin: chosen => {
        this.joinNetwork(chosen);
      }
    });
  }

  status(): HotspotStatus {
    return this.current;
  }
}
