import { describe, expect, it, vi } from 'vitest';
import { wifiPacket } from './fixtures.ts';
import { checksum, ErrorCode, ImprovSession, parseCommand, parseWifiSettings, resultPacket, State } from './improv.ts';

const EMPTY = new Uint8Array(0);
const joined = () => vi.fn().mockResolvedValue({ ok: true });
const settingsOf = (packet: Uint8Array) => parseWifiSettings(parseCommand(packet)?.data ?? EMPTY);

describe('kiosk-audio/improv', () => {
  it('sums bytes modulo 256', () => {
    expect(checksum(Uint8Array.of())).toBe(0);
    expect(checksum(Uint8Array.of(1, 2, 3))).toBe(6);
    expect(checksum(Uint8Array.of(200, 100))).toBe(44);
  });

  it('reads a whole, correct command and nothing else', () => {
    const packet = wifiPacket('Home', 'placeholder-pass');
    expect(parseCommand(packet)).toMatchObject({ command: 1 });
    expect(parseCommand(packet.subarray(0, -1))).toBeNull();
    expect(parseCommand(Uint8Array.of(1, 0))).toBeNull();
    const corrupted = Uint8Array.from(packet);
    corrupted[3] = 0;
    expect(parseCommand(corrupted)).toBeNull();
    expect(parseCommand(Uint8Array.from([...packet, 0]))).toBeNull();
  });

  it('reads the Wi-Fi settings, including a name or password that is not ASCII', () => {
    const accented = settingsOf(wifiPacket('Café ☕', 'a-é-ü-1'));
    expect(accented?.ssid).toBe('Café ☕');
    expect(accented?.password).toBe('a-é-ü-1');
    expect(settingsOf(wifiPacket('Open', ''))).toEqual({ ssid: 'Open', password: '' });
  });

  it('refuses settings that are cut short, too long, or not text', () => {
    expect(parseWifiSettings(Uint8Array.of())).toBeNull();
    expect(parseWifiSettings(Uint8Array.of(5, 65))).toBeNull();
    expect(parseWifiSettings(Uint8Array.of(1, 65))).toBeNull();
    expect(parseWifiSettings(Uint8Array.of(1, 65, 1, 66, 67))).toBeNull();
    expect(parseWifiSettings(Uint8Array.of(1, 0xff, 0))).toBeNull();
  });

  it('builds a result packet with its checksum', () => {
    expect([...resultPacket(1)]).toEqual([1, 0, 1]);
    const withUrl = resultPacket(1, ['abcdefgh']);
    expect([...withUrl.subarray(0, 3)]).toEqual([1, 9, 8]);
    expect(withUrl).toHaveLength(12);
    expect(checksum(withUrl.subarray(0, 11))).toBe(withUrl[11]);
  });

  describe('a session', () => {
    it('starts authorized, with no error and no result', () => {
      const session = new ImprovSession(joined());
      expect([session.state, session.error, session.result.length]).toEqual([State.authorized, ErrorCode.none, 0]);
    });

    it('joins the network and says it worked, telling its listeners at each step', async () => {
      const connect = joined();
      const session = new ImprovSession(connect);
      const seen: number[] = [];
      session.onChange(() => {
        seen.push(session.state);
      });
      await session.handle(wifiPacket('Home', 'placeholder-pass'));
      expect(connect).toHaveBeenCalledWith({
        ssid: 'Home',
        password: 'placeholder-pass',
        hidden: false,
        security: 'psk'
      });
      expect(seen).toEqual([State.provisioning, State.provisioned]);
      expect([...session.result]).toEqual([1, 0, 1]);
      expect(session.error).toBe(ErrorCode.none);
    });

    it('joins an open network when there is no password', async () => {
      const connect = joined();
      await new ImprovSession(connect).handle(wifiPacket('Cafe', ''));
      expect(connect).toHaveBeenCalledWith({ ssid: 'Cafe', password: '', hidden: false, security: 'open' });
    });

    it('goes back to authorized with an error when the network could not be joined', async () => {
      const session = new ImprovSession(() => Promise.resolve({ ok: false, error: 'No.' }));
      await session.handle(wifiPacket('Home', 'placeholder-pass'));
      expect([session.state, session.error]).toEqual([State.authorized, ErrorCode.unableToConnect]);
      expect(session.result).toHaveLength(0);
    });

    it('treats a connection that throws as a failed join', async () => {
      vi.spyOn(console, 'warn').mockReturnValue();
      const session = new ImprovSession(() => Promise.reject(new Error('nmcli is gone')));
      await session.handle(wifiPacket('Home', 'placeholder-pass'));
      expect([session.state, session.error]).toEqual([State.authorized, ErrorCode.unableToConnect]);
    });

    it('says what is wrong with a packet that is not a good command', async () => {
      const connect = joined();
      const session = new ImprovSession(connect);
      await session.handle(Uint8Array.of(1, 2, 3));
      expect(session.error).toBe(ErrorCode.invalidPacket);
      await session.handle(Uint8Array.of(2, 0, 2));
      expect(session.error).toBe(ErrorCode.unknownCommand);
      await session.handle(wifiPacket('', 'placeholder-pass'));
      expect(session.error).toBe(ErrorCode.invalidPacket);
      expect(connect).not.toHaveBeenCalled();
      expect(session.state).toBe(State.authorized);
    });

    it('refuses a second set of settings while it is joining', async () => {
      const first = Promise.withResolvers<{ ok: true }>();
      const connect = vi.fn().mockReturnValue(first.promise);
      const session = new ImprovSession(connect);
      const joining = session.handle(wifiPacket('Home', 'placeholder-pass'));
      await session.handle(wifiPacket('Other', 'placeholder-pass'));
      expect(session.error).toBe(ErrorCode.notAuthorized);
      expect(connect).toHaveBeenCalledOnce();
      first.resolve({ ok: true });
      await joining;
      expect(session.state).toBe(State.provisioned);
    });

    it('stops telling a listener that was removed', async () => {
      const session = new ImprovSession(joined());
      const listener = vi.fn();
      const remove = session.onChange(listener);
      remove();
      await session.handle(wifiPacket('Home', 'placeholder-pass'));
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
