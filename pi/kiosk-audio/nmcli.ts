// Wi-Fi through NetworkManager's nmcli, for the Wi-Fi setup page.
// Every command is an argument list, never a shell. The password reaches nmcli on stdin (`--ask`), never in argv, so
// `ps` does not show it, and it is never logged. The service runs as the kiosk user, which polkit lets manage
// NetworkManager (50-kiosk-networkmanager.rules).
import { spawn } from 'node:child_process';

const COMMAND_ENV = { LC_ALL: 'C', PATH: '/usr/sbin:/usr/bin:/sbin:/bin' };
const WIFI_TYPE = '802-11-wireless';
const CONNECT_WAIT_SECONDS = 45;
const SCAN_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 20_000;

export type Security = 'open' | 'psk' | 'unsupported';

export interface Network {
  ssid: string;
  /** nmcli's signal, 0 to 100. */
  signal: number;
  /** 0 to 4, for the signal icon. */
  bars: number;
  security: Security;
}

export const ERRORS = {
  wrongPassword: 'Wrong password. Check it and try again.',
  notFound: 'Network not found. Move closer to the router and refresh.',
  timeout: 'Timed out. The password may be wrong or the signal too weak.',
  disabled: 'Wi-Fi is turned off.',
  denied: 'Not allowed to change the network settings.',
  passwordLength: 'The password must be 8 to 63 characters, or 64 hexadecimal digits.',
  noNmcli: 'NetworkManager is not available.',
  generic: 'Could not connect.',
  busy: 'Already connecting. Wait for it to finish.',
  scan: 'Could not scan for networks.'
} as const;

/** How a command ended: 124 means it timed out, 127 that it could not start. */
export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export type Run = (argv: string[], stdin?: string, timeoutMs?: number) => Promise<Result>;

/** Runs a command without a shell, writing `stdin` to it. Never rejects. */
export const runCommand: Run = ([file = '', ...args], stdin = '', timeoutMs = COMMAND_TIMEOUT_MS) =>
  new Promise(resolve => {
    // The commands are fixed nmcli calls, found on COMMAND_ENV's PATH.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
    const child = spawn(file, args, { env: COMMAND_ENV, timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', error => {
      resolve({ code: 127, stdout, stderr: error.message });
    });
    child.on('close', (code, signal) => {
      resolve(
        signal === 'SIGTERM' && code === null
          ? { code: 124, stdout, stderr: 'timed out' }
          : { code: code ?? 1, stdout, stderr }
      );
    });
    child.stdin.on('error', () => {
      // nmcli did not read its input (it failed first); the exit code says why.
    });
    child.stdin.end(stdin);
  });

/** Splits one line of `nmcli -t` output on unescaped colons; `\:` and `\\` are unescaped. */
export function splitTerse(line: string): string[] {
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

/** nmcli's 0 to 100 signal as 0 to 4 bars. */
export function signalBars(signal: number): number {
  if (signal >= 75) return 4;
  if (signal >= 55) return 3;
  if (signal >= 35) return 2;
  return signal > 0 ? 1 : 0;
}

/** open, psk (WPA/WPA2/WPA3 Personal) or unsupported (enterprise, WEP, anything else). */
export function classifySecurity(text: string): Security {
  const value = text.trim();
  if (value === '' || value === '--') return 'open';
  if (value.includes('802.1X') || value.includes('WEP')) return 'unsupported';
  return value.includes('WPA') ? 'psk' : 'unsupported';
}

/**
 * The visible networks in `nmcli -t -f SSID,SIGNAL,SECURITY device wifi list` output: hidden (empty) names skipped,
 * duplicates collapsed to the strongest, strongest first.
 */
export function parseScan(output: string): Network[] {
  const best = new Map<string, Network>();
  for (const line of output.split('\n')) {
    const fields = splitTerse(line);
    const [ssid = '', signalText = '', security = ''] = fields;
    if (fields.length !== 3 || ssid.trim() === '') continue;
    const parsed = Math.trunc(Number(signalText));
    const signal = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(100, parsed));
    const known = best.get(ssid);
    if (!known || signal > known.signal) {
      best.set(ssid, { ssid, signal, bars: signalBars(signal), security: classifySecurity(security) });
    }
  }
  // eslint-disable-next-line unicorn/prefer-iterator-to-array -- TypeScript's ES2024 lib has no Iterator#toArray yet.
  return [...best.values()].toSorted(
    (a, b) => b.signal - a.signal || a.ssid.toLowerCase().localeCompare(b.ssid.toLowerCase())
  );
}

/** A WPA passphrase: 8 to 63 characters, or 64 hexadecimal digits. */
export const isValidPsk = (password: string): boolean =>
  password.length === 64 ? /^[\da-f]{64}$/i.test(password) : password.length >= 8 && password.length <= 63;

/**
 * The name of the network the Wi-Fi is on, from `nmcli -t -f ACTIVE,SSID device wifi list` output, or null when it is
 * on none.
 */
export function parseActiveSsid(output: string): string | null {
  for (const line of output.split('\n')) {
    const [active, ssid = ''] = splitTerse(line);
    if (active === 'yes' && ssid !== '') return ssid;
  }
  return null;
}

/** A short message for the user from a failed nmcli call. Never echoes nmcli's text, which may name the network. */
export function friendlyError(code: number, stderr: string): string {
  const text = stderr.toLowerCase();
  if (code === 124 || text.includes('timeout expired') || text.includes('timed out')) return ERRORS.timeout;
  if (code === 127) return ERRORS.noNmcli;
  if (text.includes('secrets were required') || text.includes('no secrets')) return ERRORS.wrongPassword;
  if (text.includes('psk') && text.includes('invalid')) return ERRORS.passwordLength;
  if (text.includes('no network with ssid') || text.includes('could not be found')) return ERRORS.notFound;
  if (text.includes('disabled')) return ERRORS.disabled;
  if (text.includes('not authorized') || text.includes('insufficient privileges')) return ERRORS.denied;
  return ERRORS.generic;
}

export class ScanError extends Error {}

export interface ConnectRequest {
  ssid: string;
  password: string;
  /** A network that does not broadcast its name, joined by name; an empty password means it is open. */
  hidden: boolean;
  security: Security;
}

/** The outcome of a connect: the message is safe to show. */
export type ConnectResult = { ok: true } | { ok: false; error: string };

export class Nmcli {
  private readonly run: Run;
  // One scan at a time (a second caller shares it), and no new attempt while one is connecting.
  private scanning: Promise<Network[]> | undefined;
  private isConnecting = false;

  constructor(run: Run = runCommand) {
    this.run = run;
  }

  private async call(argv: string[], stdin?: string, timeoutMs?: number): Promise<Result> {
    const result = await this.run(argv, stdin, timeoutMs);
    if (result.code !== 0) {
      // The argv holds no secret, and neither does nmcli's stderr: the password only ever travels on stdin.
      console.info(`${argv.slice(0, 4).join(' ')} exited ${result.code}: ${result.stderr.trim().slice(0, 160)}`);
    }
    return result;
  }

  private async scanOnce(): Promise<Network[]> {
    await this.call(['nmcli', 'radio', 'wifi', 'on']);
    const { code, stdout, stderr } = await this.call(
      ['nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes'],
      undefined,
      SCAN_TIMEOUT_MS
    );
    if (code !== 0) {
      const isKnown = code === 124 || code === 127 || stderr.toLowerCase().includes('disabled');
      throw new ScanError(isKnown ? friendlyError(code, stderr) : ERRORS.scan);
    }
    return parseScan(stdout);
  }

  private async wifiUuids(isActive: boolean): Promise<string[]> {
    const argv = ['nmcli', '-t', '-f', 'UUID,TYPE', 'connection', 'show'];
    if (isActive) argv.push('--active');
    const { code, stdout } = await this.call(argv);
    const lines = code === 0 ? stdout.split('\n') : [];
    return lines
      .map(line => splitTerse(line))
      .filter(row => row.length === 2 && row[1] === WIFI_TYPE)
      .map(([uuid = '']) => uuid);
  }

  private async connectOnce({ ssid, password, hidden, security: given }: ConnectRequest): Promise<ConnectResult> {
    let security = given;
    if (hidden) security = password ? 'psk' : 'open';
    if (security === 'unsupported') return { ok: false, error: ERRORS.generic };
    if (security === 'psk' && !isValidPsk(password)) return { ok: false, error: ERRORS.passwordLength };
    const [activeBefore, savedBefore] = await Promise.all([this.wifiUuids(true), this.wifiUuids(false)]);

    const argv = ['nmcli', '--wait', String(CONNECT_WAIT_SECONDS)];
    if (security === 'psk') argv.push('--ask');
    argv.push('device', 'wifi', 'connect', ssid);
    if (hidden) argv.push('hidden', 'yes');
    const stdin = security === 'psk' ? `${password}\n` : '';
    const { code, stderr } = await this.call(argv, stdin, (CONNECT_WAIT_SECONDS + 15) * 1000);
    if (code === 0) return { ok: true };

    const saved = new Set(savedBefore);
    const savedNow = await this.wifiUuids(false);
    for (const uuid of savedNow) {
      // One at a time: NetworkManager handles these in order anyway.
      // eslint-disable-next-line no-await-in-loop -- see above
      if (!saved.has(uuid)) await this.call(['nmcli', 'connection', 'delete', 'uuid', uuid]);
    }
    const [previous] = activeBefore;
    const activeNow = new Set(await this.wifiUuids(true));
    if (previous !== undefined && activeBefore.every(uuid => !activeNow.has(uuid))) {
      await this.call(['nmcli', 'connection', 'up', 'uuid', previous], undefined, CONNECT_WAIT_SECONDS * 1000);
    }
    return { ok: false, error: friendlyError(code, stderr) };
  }

  /** The name of the network the Wi-Fi is on now, or null when it is on none or NetworkManager cannot say. */
  async current(): Promise<string | null> {
    // What NetworkManager already knows: a scan would take seconds, and this is asked each time the settings open.
    const { code, stdout } = await this.call([
      'nmcli',
      '-t',
      '-f',
      'ACTIVE,SSID',
      'device',
      'wifi',
      'list',
      '--rescan',
      'no'
    ]);
    return code === 0 ? parseActiveSsid(stdout) : null;
  }

  /** Turns the radio on, then lists the networks in range. Rejects with a ScanError whose message is safe to show. */
  async scan(): Promise<Network[]> {
    this.scanning ??= this.scanOnce();
    try {
      return await this.scanning;
    } finally {
      this.scanning = undefined;
    }
  }

  /** Joins a network. A failed attempt deletes the profile it created and brings the Wi-Fi that was on back. */
  async connect(request: ConnectRequest): Promise<ConnectResult> {
    if (this.isConnecting) return { ok: false, error: ERRORS.busy };
    this.isConnecting = true;
    try {
      return await this.connectOnce(request);
    } finally {
      this.isConnecting = false;
    }
  }
}

/** The body of POST /wifi/connect as a request, or null when it is not one. */
export function parseConnectRequest(value: unknown): ConnectRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const { ssid, password, hidden, security } = value as Record<string, unknown>;
  if (security !== 'open' && security !== 'psk') return null;
  if (typeof ssid !== 'string' || typeof password !== 'string') return null;
  // A network name is at most 32 bytes; a passphrase at most 64 characters.
  return ssid === '' || ssid.length > 32 || password.length > 64
    ? null
    : { ssid, password, hidden: hidden === true, security };
}
