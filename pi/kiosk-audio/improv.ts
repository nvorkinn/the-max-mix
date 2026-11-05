// Improv Wi-Fi over Bluetooth LE (https://www.improv-wifi.com/ble/): a phone sends the kiosk the name and password of a
// Wi-Fi network, so nobody has to type a long password on the tablet. This file is the protocol only: the packets, and a
// session that turns a "send Wi-Fi settings" command into a connection and tells the phone how it went. The Bluetooth
// side (a GATT service BlueZ advertises) is improv-gatt.ts, and phone-setup.ts decides when it runs.
import type { ConnectRequest, ConnectResult } from './nmcli.ts';

// The service and its characteristics differ only in the last digit.
const uuid = (last: number): string => `00467768-6228-2272-4663-27747826800${last}`;
export const SERVICE_UUID = uuid(0);
export const CHARACTERISTICS = {
  state: uuid(1),
  error: uuid(2),
  command: uuid(3),
  result: uuid(4),
  capabilities: uuid(5)
} as const;

/** The current-state values of the protocol. */
export const State = { authorizationRequired: 1, authorized: 2, provisioning: 3, provisioned: 4 } as const;
export type StateValue = (typeof State)[keyof typeof State];

/** The error-state values of the protocol. */
export const ErrorCode = {
  none: 0,
  invalidPacket: 1,
  unknownCommand: 2,
  unableToConnect: 3,
  notAuthorized: 4,
  unknown: 255
} as const;
export type ErrorValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The one command this implements: send the Wi-Fi settings and connect. */
const WIFI_SETTINGS = 1;
// No capabilities: the kiosk has no way to identify itself with a light or a sound.
export const CAPABILITIES = 0;

/** The checksum of a packet: the sum of its bytes, modulo 256. */
export function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const byte of bytes) sum = (sum + byte) % 256;
  return sum;
}

/** An RPC command packet (`command, length, data…, checksum`), or null when it is not a whole, correct one. */
export function parseCommand(packet: Uint8Array): { command: number; data: Uint8Array } | null {
  if (packet.length < 3) return null;
  const length = packet[1] ?? 0;
  if (packet.length !== length + 3) return null;
  const body = packet.subarray(0, -1);
  return checksum(body) === packet.at(-1) ? { command: packet[0] ?? 0, data: packet.subarray(2, 2 + length) } : null;
}

/** The Wi-Fi settings in a command's data (`ssid length, ssid, password length, password`), or null when malformed. */
export function parseWifiSettings(data: Uint8Array): { ssid: string; password: string } | null {
  const ssidLength = data[0];
  if (ssidLength === undefined || data.length < ssidLength + 2) return null;
  const passwordLength = data[1 + ssidLength];
  if (passwordLength === undefined || data.length !== ssidLength + passwordLength + 2) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    return {
      ssid: decoder.decode(data.subarray(1, 1 + ssidLength)),
      password: decoder.decode(data.subarray(2 + ssidLength))
    };
  } catch {
    return null;
  }
}

/** An RPC result packet: the command it answers and a list of strings (the URLs to show the person, here none). */
export function resultPacket(command: number, strings: readonly string[] = []): Uint8Array {
  const encoder = new TextEncoder();
  const data: number[] = [];
  for (const text of strings) {
    const bytes = encoder.encode(text);
    data.push(bytes.length, ...bytes);
  }
  const body = Uint8Array.from([command, data.length, ...data]);
  return Uint8Array.from([...body, checksum(body)]);
}

/** Joins a network; the same as the Wi-Fi setup page's Connect. */
export type Connect = (request: ConnectRequest) => Promise<ConnectResult>;

/**
 * One phone's setup. It starts authorized, because the Bluetooth side only runs after someone tapped the button on the
 * tablet: that tap is the proof that a person is next to the kiosk, which the protocol asks for.
 */
export class ImprovSession {
  private readonly connect: Connect;
  private readonly listeners = new Set<() => void>();
  state: StateValue = State.authorized;
  error: ErrorValue = ErrorCode.none;
  result: Uint8Array = new Uint8Array(0);

  constructor(connect: Connect) {
    this.connect = connect;
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private fail(error: ErrorValue): void {
    this.error = error;
    this.changed();
  }

  /** Joins the network; a connection that throws is a failed join, not a crash. */
  private async join(request: ConnectRequest): Promise<ConnectResult> {
    try {
      return await this.connect(request);
    } catch (error) {
      console.warn(`improv: joining failed: ${String(error)}`);
      return { ok: false, error: 'Could not connect.' };
    }
  }

  /** Calls `listener` after each change of the state, the error or the result, so the phone can be notified. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Handles what the phone wrote to the command characteristic. */
  async handle(packet: Uint8Array): Promise<void> {
    const parsed = parseCommand(packet);
    if (!parsed) {
      this.fail(ErrorCode.invalidPacket);
      return;
    }
    if (parsed.command !== WIFI_SETTINGS) {
      this.fail(ErrorCode.unknownCommand);
      return;
    }
    if (this.state !== State.authorized) {
      this.fail(ErrorCode.notAuthorized);
      return;
    }
    const settings = parseWifiSettings(parsed.data);
    if (!settings || settings.ssid === '') {
      this.fail(ErrorCode.invalidPacket);
      return;
    }

    this.error = ErrorCode.none;
    this.state = State.provisioning;
    this.changed();
    const joined = await this.join({
      ssid: settings.ssid,
      password: settings.password,
      hidden: false,
      security: settings.password === '' ? 'open' : 'psk'
    });
    if (joined.ok) {
      this.result = resultPacket(WIFI_SETTINGS);
      this.state = State.provisioned;
      this.changed();
    } else {
      this.state = State.authorized;
      this.fail(ErrorCode.unableToConnect);
    }
  }
}
