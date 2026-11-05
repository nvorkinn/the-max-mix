// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  classifySecurity,
  ERRORS,
  friendlyError,
  isValidPsk,
  Nmcli,
  parseConnectRequest,
  parseScan,
  runCommand,
  ScanError,
  signalBars,
  splitTerse
} from './nmcli.ts';
import type { Result, Run } from './nmcli.ts';

const SCAN = [
  String.raw`Home\:Net:80:WPA2`,
  String.raw`Home\:Net:40:WPA2`,
  'Cafe:55:--',
  ':30:WPA2',
  'Office:90:WPA2 WPA3',
  'Campus:70:WPA2 802.1X',
  String.raw`Back\\slash:20:WPA1 WPA2`,
  'Broken line',
  'Odd:abc:WPA2'
].join('\n');

const WIFI_ROWS = 'aaaa-1:802-11-wireless\nbbbb-2:802-3-ethernet\ncccc-3:802-11-wireless\n';
const ok = (stdout = ''): Result => ({ code: 0, stdout, stderr: '' });

type Reply = Result | ((argv: string[]) => Result);

/** Stands in for nmcli: replies are matched on the start of argv, and every call is recorded. */
function stub(replies: [string[], Reply][]) {
  const calls: { argv: string[]; stdin: string | undefined }[] = [];
  const run: Run = (argv, stdin) => {
    calls.push({ argv, stdin });
    const match = replies.find(([prefix]) => prefix.every((part, index) => argv[index] === part));
    const reply = match?.[1] ?? ok();
    return Promise.resolve(typeof reply === 'function' ? reply(argv) : reply);
  };
  const called = (...prefix: string[]) =>
    calls.map(call => call.argv).filter(argv => prefix.every((part, index) => argv[index] === part));
  return { run, calls, called };
}

describe('parsing', () => {
  it('splits terse output on unescaped colons', () => {
    expect(splitTerse(String.raw`a\:b:c`)).toEqual(['a:b', 'c']);
    expect(splitTerse(String.raw`a\\:b`)).toEqual(['a\\', 'b']);
    expect(splitTerse('::')).toEqual(['', '', '']);
  });

  it('maps the signal to bars', () => {
    expect([0, 1, 34, 35, 54, 55, 74, 75, 100].map(signal => signalBars(signal))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('tells which networks it can join', () => {
    expect(
      ['', '--', 'WPA2', 'WPA2 WPA3', 'WPA3', 'WPA2 802.1X', 'WEP', 'OWE'].map(text => classifySecurity(text))
    ).toEqual(['open', 'open', 'psk', 'psk', 'psk', 'unsupported', 'unsupported', 'unsupported']);
  });

  it('lists each visible network once, strongest first', () => {
    const networks = parseScan(SCAN);
    expect(networks.map(({ ssid, signal, security }) => [ssid, signal, security])).toEqual([
      ['Office', 90, 'psk'],
      ['Home:Net', 80, 'psk'],
      ['Campus', 70, 'unsupported'],
      ['Cafe', 55, 'open'],
      ['Back\\slash', 20, 'psk'],
      ['Odd', 0, 'psk']
    ]);
    expect(networks.map(network => network.bars)).toEqual([4, 4, 3, 3, 1, 0]);
    expect(parseScan('')).toEqual([]);
  });

  it('checks WPA passphrases', () => {
    expect(isValidPsk('12345678')).toBe(true);
    expect(isValidPsk('x'.repeat(63))).toBe(true);
    expect(isValidPsk('ab12'.repeat(16))).toBe(true);
    expect(isValidPsk('short')).toBe(false);
    expect(isValidPsk('x'.repeat(64))).toBe(false);
    expect(isValidPsk('x'.repeat(65))).toBe(false);
  });
});

describe('friendlyError', () => {
  it.each([
    [1, 'Error: Connection activation failed: (7) Secrets were required, but not provided.', ERRORS.wrongPassword],
    [1, "Error: No network with SSID 'x' found.", ERRORS.notFound],
    [1, 'Error: Timeout expired (45 seconds)', ERRORS.timeout],
    [124, 'timed out', ERRORS.timeout],
    [127, 'No such file', ERRORS.noNmcli],
    [1, 'Error: Wi-Fi is disabled', ERRORS.disabled],
    [1, 'Error: Failed to add/activate: Not authorized to control networking.', ERRORS.denied],
    [1, '802-11-wireless-security.psk: property is invalid', ERRORS.passwordLength],
    [1, 'something else', ERRORS.generic]
  ])('maps exit %i "%s"', (code, text, expected) => {
    expect(friendlyError(code, text)).toBe(expected);
  });
});

describe('scan', () => {
  it('turns the radio on and lists the networks', async () => {
    const { run, calls } = stub([[['nmcli', '-t'], ok(SCAN)]]);
    const networks = await new Nmcli(run).scan();
    expect(networks[0]?.ssid).toBe('Office');
    expect(calls.map(call => call.argv)).toEqual([
      ['nmcli', 'radio', 'wifi', 'on'],
      ['nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes']
    ]);
  });

  it('shares a scan that is still running', async () => {
    const { run, called } = stub([[['nmcli', '-t'], ok(SCAN)]]);
    const nmcli = new Nmcli(run);
    await Promise.all([nmcli.scan(), nmcli.scan()]);
    expect(called('nmcli', '-t')).toHaveLength(1);
  });

  it('fails with a message that is safe to show', async () => {
    vi.spyOn(console, 'info').mockReturnValue();
    await expect(new Nmcli(stub([[['nmcli'], { code: 1, stdout: '', stderr: 'boom' }]]).run).scan()).rejects.toThrow(
      new ScanError(ERRORS.scan)
    );
    const disabled = stub([[['nmcli'], { code: 1, stdout: '', stderr: 'Error: Wi-Fi is disabled' }]]);
    await expect(new Nmcli(disabled.run).scan()).rejects.toThrow(ERRORS.disabled);
  });
});

/** Before the attempt cccc-3 is active and aaaa-1, cccc-3 are saved; savedAfter and activeAfter follow it. */
function client(connectReply: Result, savedAfter = WIFI_ROWS, activeAfter = 'cccc-3:802-11-wireless\n') {
  let isAttempted = false;
  const show = (argv: string[]): Result => {
    const isActive = argv.includes('--active');
    if (isAttempted) return ok(isActive ? activeAfter : savedAfter);
    return ok(isActive ? 'cccc-3:802-11-wireless\n' : WIFI_ROWS);
  };
  const connect = (): Result => {
    isAttempted = true;
    return connectReply;
  };
  const fake = stub([
    [['nmcli', '-t', '-f', 'UUID,TYPE', 'connection', 'show'], show],
    [['nmcli', '--wait'], connect]
  ]);
  return { nmcli: new Nmcli(fake.run), ...fake };
}

describe('connect', () => {
  it('passes the password on stdin, never in argv', async () => {
    const { nmcli, calls } = client(ok());
    await expect(
      nmcli.connect({ ssid: 'Home', password: 's3cretpass', hidden: false, security: 'psk' })
    ).resolves.toEqual({ ok: true });
    const attempt = calls.find(call => call.argv[1] === '--wait');
    expect(attempt?.argv).toEqual(['nmcli', '--wait', '45', '--ask', 'device', 'wifi', 'connect', 'Home']);
    expect(attempt?.stdin).toBe('s3cretpass\n');
    expect(calls.some(call => call.argv.some(part => part.includes('s3cretpass')))).toBe(false);
  });

  it('joins an open network without asking', async () => {
    const { nmcli, called } = client(ok());
    await nmcli.connect({ ssid: 'Cafe', password: '', hidden: false, security: 'open' });
    expect(called('nmcli', '--wait')).toEqual([['nmcli', '--wait', '45', 'device', 'wifi', 'connect', 'Cafe']]);
  });

  it('joins a hidden network by name, open when there is no password', async () => {
    const secured = client(ok());
    await secured.nmcli.connect({ ssid: 'Ghost', password: 'longenough', hidden: true, security: 'open' });
    expect(secured.called('nmcli', '--wait')[0]).toEqual([
      'nmcli',
      '--wait',
      '45',
      '--ask',
      'device',
      'wifi',
      'connect',
      'Ghost',
      'hidden',
      'yes'
    ]);
    const open = client(ok());
    await open.nmcli.connect({ ssid: 'Ghost', password: '', hidden: true, security: 'psk' });
    expect(open.called('nmcli', '--wait')[0]).not.toContain('--ask');
  });

  it('refuses bad input without calling nmcli', async () => {
    const { nmcli, calls } = client(ok());
    await expect(nmcli.connect({ ssid: 'Home', password: 'short', hidden: false, security: 'psk' })).resolves.toEqual({
      ok: false,
      error: ERRORS.passwordLength
    });
    await expect(
      nmcli.connect({ ssid: 'Corp', password: 'whatever1', hidden: false, security: 'unsupported' })
    ).resolves.toEqual({ ok: false, error: ERRORS.generic });
    expect(calls).toEqual([]);
  });

  it('cleans up after a failure and brings the old connection back', async () => {
    vi.spyOn(console, 'info').mockReturnValue();
    const { nmcli, called } = client(
      {
        code: 1,
        stdout: '',
        stderr: 'Error: Connection activation failed: (7) Secrets were required, but not provided.'
      },
      `${WIFI_ROWS}dddd-4:802-11-wireless\n`,
      ''
    );
    await expect(
      nmcli.connect({ ssid: 'Home', password: 'wrongpass1', hidden: false, security: 'psk' })
    ).resolves.toEqual({ ok: false, error: ERRORS.wrongPassword });
    expect(called('nmcli', 'connection', 'delete')).toEqual([['nmcli', 'connection', 'delete', 'uuid', 'dddd-4']]);
    expect(called('nmcli', 'connection', 'up')).toEqual([['nmcli', 'connection', 'up', 'uuid', 'cccc-3']]);
  });

  it('leaves a connection that is still active alone', async () => {
    vi.spyOn(console, 'info').mockReturnValue();
    const { nmcli, called } = client({ code: 1, stdout: '', stderr: "Error: No network with SSID 'Home' found." });
    await expect(
      nmcli.connect({ ssid: 'Home', password: 'wrongpass1', hidden: false, security: 'psk' })
    ).resolves.toEqual({ ok: false, error: ERRORS.notFound });
    expect(called('nmcli', 'connection', 'delete')).toEqual([]);
    expect(called('nmcli', 'connection', 'up')).toEqual([]);
  });

  it('refuses a second attempt while one is running', async () => {
    const attempt = Promise.withResolvers<Result>();
    let isWaiting = false;
    const others = stub([]);
    const run: Run = (argv, stdin, timeout) => {
      if (argv[1] !== '--wait') return others.run(argv, stdin, timeout);
      isWaiting = true;
      return attempt.promise;
    };
    const nmcli = new Nmcli(run);
    const request = { ssid: 'Home', password: 'longenough', hidden: false, security: 'psk' } as const;
    const first = nmcli.connect(request);
    await expect(nmcli.connect(request)).resolves.toEqual({ ok: false, error: ERRORS.busy });
    await vi.waitFor(() => {
      expect(isWaiting).toBe(true);
    });
    attempt.resolve(ok());
    await expect(first).resolves.toEqual({ ok: true });
  });
});

describe('parseConnectRequest', () => {
  it('accepts a request and drops anything else in it', () => {
    expect(parseConnectRequest({ ssid: 'Home', password: 'pw', hidden: true, security: 'psk', extra: 1 })).toEqual({
      ssid: 'Home',
      password: 'pw',
      hidden: true,
      security: 'psk'
    });
  });

  it.each([
    null,
    'Home',
    { ssid: '', password: '', security: 'open' },
    { ssid: 'Home', password: 1, security: 'psk' },
    { ssid: 'Home', password: 'x'.repeat(65), security: 'psk' },
    { ssid: 'Home', password: '', security: 'unsupported' }
  ])('refuses %j', body => {
    expect(parseConnectRequest(body)).toBeNull();
  });
});

describe('runCommand', () => {
  it('passes stdin and collects the output', async () => {
    await expect(runCommand(['cat'], 'hello')).resolves.toEqual({ code: 0, stdout: 'hello', stderr: '' });
  });

  it('reports a program that is not there', async () => {
    expect((await runCommand(['no-such-program-here'])).code).toBe(127);
  });
});
