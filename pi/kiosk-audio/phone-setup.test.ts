import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wifiPacket } from './fixtures.ts';
import type { Advertising } from './improv-gatt.ts';
import { ImprovSession, State } from './improv.ts';
import { PhoneSetup } from './phone-setup.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(isJoining = true) {
  const sessions: ImprovSession[] = [];
  const stops = vi.fn().mockResolvedValue(undefined);
  const advertise = vi.fn((session: ImprovSession): Promise<Advertising> => {
    sessions.push(session);
    return Promise.resolve({ stop: stops });
  });
  const connect = vi.fn().mockResolvedValue(isJoining ? { ok: true } : { ok: false, error: 'Wrong password.' });
  const phone = new PhoneSetup({ connect, advertise });
  return { phone, sessions, stops, advertise, connect };
}

const firstOf = (sessions: ImprovSession[]): ImprovSession => {
  const [session] = sessions;
  if (!session) throw new Error('Nothing was advertised');
  return session;
};

describe('kiosk-audio/phone-setup', () => {
  it('starts advertising once, however often it is asked', async () => {
    const { phone, advertise } = setup();
    await Promise.all([phone.start(), phone.start()]);
    await phone.start();
    expect(advertise).toHaveBeenCalledOnce();
  });

  it('stops advertising after a few minutes, and can start again', async () => {
    const { phone, advertise, stops } = setup();
    await phone.start();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    expect(stops).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stops).toHaveBeenCalledOnce();
    await phone.start();
    expect(advertise).toHaveBeenCalledTimes(2);
  });

  it('gives the phone more time when the button is tapped again', async () => {
    const { phone, stops } = setup();
    await phone.start();
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    await phone.start();
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(stops).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(stops).toHaveBeenCalledOnce();
  });

  it('stops advertising a moment after the phone has joined a network', async () => {
    const { phone, sessions, stops, connect } = setup();
    await phone.start();
    const session = firstOf(sessions);
    await session.handle(wifiPacket('Home', 'placeholder-pass'));
    expect(session.state).toBe(State.provisioned);
    expect(connect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4000 - 1);
    expect(stops).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stops).toHaveBeenCalledOnce();
  });

  it('keeps advertising when the phone could not join, so it can try again', async () => {
    const { phone, sessions, stops } = setup(false);
    await phone.start();
    await firstOf(sessions).handle(wifiPacket('Home', 'placeholder-bad'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stops).not.toHaveBeenCalled();
    expect(phone.status()).toEqual({ state: 'waiting', error: 'Could not join that network.' });
  });

  it('says where the setup is: waiting, joining, then joined until it starts again', async () => {
    let finish: (result: { ok: true }) => void = () => {};
    const connect = vi.fn(
      () =>
        new Promise<{ ok: true }>(resolve => {
          finish = resolve;
        })
    );
    const sessions: ImprovSession[] = [];
    const phone = new PhoneSetup({
      connect,
      advertise: session => {
        sessions.push(session);
        return Promise.resolve({ stop: vi.fn().mockResolvedValue(undefined) });
      }
    });
    expect(phone.status()).toEqual({ state: 'idle' });
    await phone.start();
    expect(phone.status()).toEqual({ state: 'waiting' });
    const handled = firstOf(sessions).handle(wifiPacket('Home', 'placeholder-pass'));
    expect(phone.status()).toEqual({ state: 'joining' });
    finish({ ok: true });
    await handled;
    expect(phone.status()).toEqual({ state: 'joined' });
    // Advertising stops a moment later; the tablet still hears that it worked.
    await vi.advanceTimersByTimeAsync(4000);
    expect(phone.status()).toEqual({ state: 'joined' });
    await phone.start();
    expect(phone.status()).toEqual({ state: 'waiting' });
  });

  it('is idle again once stopped', async () => {
    const { phone } = setup();
    await phone.start();
    await phone.stop();
    expect(phone.status()).toEqual({ state: 'idle' });
  });

  it('rejects when Bluetooth would not start, and can be tried again', async () => {
    const advertise = vi.fn().mockRejectedValueOnce(new Error('no bluetooth')).mockResolvedValue({ stop: vi.fn() });
    const phone = new PhoneSetup({ connect: vi.fn(), advertise });
    await expect(phone.start()).rejects.toThrow('no bluetooth');
    await expect(phone.start()).resolves.toBeUndefined();
  });

  it('does nothing when told to stop while it is not running', async () => {
    const { phone, stops } = setup();
    await phone.stop();
    expect(stops).not.toHaveBeenCalled();
  });
});
