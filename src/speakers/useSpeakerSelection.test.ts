import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { getKioskSonosLeader, setKioskSonosLeader } from '../sonos/kiosk';
import { getDevices } from '../spotify/api';
import { deferred } from '../test/deferred';
import type { SpotifyDevice } from '../types';
import { recordSpotifyRetryAfter, resetSpotifyRateLimit, SpotifyApiError } from '../spotify/http';
import type { PiSonosGroup } from '../sonos/kiosk';
import { DEVICES_POLL_MS, useSpeakerSelection } from './useSpeakerSelection';
import type { SpeakerSelectionOptions } from './useSpeakerSelection';

const pi = vi.hoisted(() => ({
  findSonosOnPi: vi.fn(),
  watchSonosOnPi: vi.fn(),
  getSonosNow: vi.fn(),
  setSonosVolume: vi.fn(),
  joinSonosGroup: vi.fn(),
  leaveSonosGroup: vi.fn()
}));
const airplay = vi.hoisted(() => ({
  listAudioOutputs: vi.fn(),
  watchAudioOutputs: vi.fn(),
  routeAudio: vi.fn(),
  getChosenSpeakers: vi.fn(),
  setChosenSpeakers: vi.fn(),
  setSpeakerVolume: vi.fn()
}));
vi.mock('../sonos/kiosk', async importOriginal => ({
  ...(await importOriginal<typeof import('../sonos/kiosk')>()),
  ...pi
}));
vi.mock('../audio/airplay', () => airplay);
vi.mock('../spotify/api', () => ({ getDevices: vi.fn().mockResolvedValue({ devices: [] }) }));

const group = (...names: string[]): PiSonosGroup => ({
  id: names.join('+'),
  rooms: names.map(name => ({ id: name, name }))
});
let groups: PiSonosGroup[] = [];

function options(overrides: Partial<SpeakerSelectionOptions> = {}): SpeakerSelectionOptions {
  return {
    onKiosk: true,
    open: true,
    browserDeviceId: 'web-1',
    playingDeviceId: 'web-1',
    sonosName: null,
    transfer: vi.fn().mockResolvedValue(undefined),
    playOnSonos: vi.fn().mockResolvedValue(undefined),
    leaveSonos: vi.fn(() => {
      setKioskSonosLeader(null);
      return Promise.resolve();
    }),
    ...overrides
  };
}

/** Lets the hook read again and render, a second at a time, as the Pi would answer. */
async function seconds(count: number) {
  for (let second = 0; second < count; second += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(() => vi.advanceTimersByTimeAsync(1000));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  setKioskSonosLeader(null);
  groups = [group('Bath'), group('Kitchen'), group('Office')];
  pi.findSonosOnPi.mockImplementation(() => Promise.resolve({ groups, ms: 0 }));
  pi.watchSonosOnPi.mockReturnValue(vi.fn());
  pi.getSonosNow.mockResolvedValue({ volume: 40 });
  pi.setSonosVolume.mockResolvedValue(undefined);
  pi.joinSonosGroup.mockResolvedValue(undefined);
  pi.leaveSonosGroup.mockResolvedValue(undefined);
  airplay.listAudioOutputs.mockResolvedValue({ outputs: [], legacy: false });
  airplay.watchAudioOutputs.mockReturnValue(vi.fn());
  airplay.getChosenSpeakers.mockReturnValue([]);
});
afterEach(() => {
  resetSpotifyRateLimit();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useSpeakerSelection with Sonos', () => {
  it("leaves out a Sonos room's AirPlay sink, and what it plays, since Sonos plays it", async () => {
    const output = (name: string, kind: 'airplay' | 'bluetooth', linked: boolean) => ({
      id: `${kind}.${name}`,
      name,
      kind,
      volume: 10,
      linked
    });
    airplay.listAudioOutputs.mockResolvedValue({
      outputs: [
        output('kitchen', 'airplay', true),
        output('Mac mini', 'airplay', false),
        output('Kitchen', 'bluetooth', false)
      ],
      legacy: false
    });
    const { result } = renderHook(() => useSpeakerSelection(options()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.outputs.map(shown => shown.id)).toEqual(['airplay.Mac mini', 'bluetooth.Kitchen']);
    expect(result.current.confirmed).toEqual({ family: 'tablet', outputs: [] });
  });

  it('drops a draft on Cancel, changing nothing', async () => {
    const given = options();
    const { result } = renderHook(() => useSpeakerSelection(given));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const before = result.current.shown;
    act(() => result.current.toggle('sonos:Kitchen'));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.cancel());
    expect(result.current.dirty).toBe(false);
    expect(result.current.shown).toEqual(before);
    expect(given.playOnSonos).not.toHaveBeenCalled();
  });

  it('starts the first room ticked, turned down, and adds the others to it', async () => {
    const given = options();
    const { result } = renderHook(() => useSpeakerSelection(given));
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => result.current.toggle('sonos:Kitchen'));
    act(() => result.current.toggle('sonos:Bath'));
    expect(result.current.dirty).toBe(true);
    expect(given.playOnSonos).not.toHaveBeenCalled();
    act(() => {
      void result.current.save();
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(pi.setSonosVolume).toHaveBeenCalledWith('Bath', 25);
    expect(given.playOnSonos).toHaveBeenCalledWith('Bath');
    expect(pi.joinSonosGroup).toHaveBeenCalledWith('Kitchen', 'Bath');
    expect(getKioskSonosLeader()).toBe('Bath');
    expect(result.current.saving).toBe(true);
    groups = [group('Bath', 'Kitchen'), group('Office')];
    await seconds(3);
    expect(result.current.saving).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('adds rooms before taking any out, and follows the group when its leading room leaves', async () => {
    setKioskSonosLeader('Kitchen');
    groups = [group('Kitchen', 'Bath'), group('Office')];
    const given = options({ playingDeviceId: null });
    const { result } = renderHook(() => useSpeakerSelection(given));
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => result.current.toggle('sonos:Office'));
    act(() => result.current.toggle('sonos:Kitchen'));
    act(() => {
      void result.current.save();
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(pi.joinSonosGroup).toHaveBeenCalledWith('Office', 'Kitchen');
    expect(pi.leaveSonosGroup).toHaveBeenCalledWith('Kitchen');
    expect(pi.joinSonosGroup.mock.invocationCallOrder[0]).toBeLessThan(
      pi.leaveSonosGroup.mock.invocationCallOrder[0] ?? 0
    );
    expect(getKioskSonosLeader()).toBe('Bath');
    expect(given.playOnSonos).not.toHaveBeenCalled();
  });

  it('pauses the Sonos when every room is taken out, without waiting for anything to show it', async () => {
    setKioskSonosLeader('Kitchen');
    const given = options({ playingDeviceId: null });
    const { result } = renderHook(() => useSpeakerSelection(given));
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => result.current.toggle('sonos:Kitchen'));
    await act(() => result.current.save());
    expect(given.leaveSonos).toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('pauses the Sonos before moving Spotify to a Connect device', async () => {
    setKioskSonosLeader('Kitchen');
    const given = options({ playingDeviceId: null });
    const { result } = renderHook(() => useSpeakerSelection(given));
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => result.current.toggle('connect:dev2'));
    act(() => {
      void result.current.save();
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(given.leaveSonos).toHaveBeenCalled();
    expect(given.transfer).toHaveBeenCalledWith('dev2');
  });

  it('says what went wrong and keeps the draft when Sonos refuses', async () => {
    pi.joinSonosGroup.mockRejectedValue(new Error('Sonos: no speakers answered.'));
    setKioskSonosLeader('Kitchen');
    const given = options({ playingDeviceId: null });
    const { result } = renderHook(() => useSpeakerSelection(given));
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => result.current.toggle('sonos:Bath'));
    await act(() => result.current.save());
    expect(result.current.error).toBe('Sonos: no speakers answered.');
    expect(result.current.dirty).toBe(true);
  });
});

describe('useSpeakerSelection keeping the lists fresh', () => {
  const devicesRead = () => vi.mocked(getDevices).mock.calls.length;

  it("reads Spotify's devices again every few seconds while the view shows, and stops when it closes", async () => {
    const { result, rerender } = renderHook((given: SpeakerSelectionOptions) => useSpeakerSelection(given), {
      initialProps: options()
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(devicesRead()).toBe(1);
    vi.mocked(getDevices).mockResolvedValue({ devices: [{ id: 'phone', name: 'Phone' }] });
    await act(() => vi.advanceTimersByTimeAsync(DEVICES_POLL_MS));
    expect(devicesRead()).toBe(2);
    expect(result.current.connectDevices.map(device => device.name)).toEqual(['Phone']);
    // Only Spotify's list is polled: the Pi's lists have their own watchers.
    expect(pi.findSonosOnPi).toHaveBeenCalledTimes(1);
    rerender(options({ open: false }));
    await act(() => vi.advanceTimersByTimeAsync(DEVICES_POLL_MS * 3));
    expect(devicesRead()).toBe(2);
  });

  it('does not poll while Spotify has asked the app to wait', async () => {
    renderHook(() => useSpeakerSelection(options()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(devicesRead()).toBe(1);
    recordSpotifyRetryAfter(new SpotifyApiError('Too many requests', 429, 25));
    await act(() => vi.advanceTimersByTimeAsync(DEVICES_POLL_MS * 2));
    expect(devicesRead()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(DEVICES_POLL_MS));
    expect(devicesRead()).toBe(2);
  });

  it('reads every list again on refresh, busy until the reads finish', async () => {
    const { result } = renderHook(() => useSpeakerSelection(options()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.refreshing).toBe(false);
    const answer = deferred<{ devices: SpotifyDevice[] }>();
    vi.mocked(getDevices).mockReturnValueOnce(answer.promise);
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.refresh();
    });
    expect(result.current.refreshing).toBe(true);
    // A second tap while it reads asks nothing more.
    act(() => {
      void result.current.refresh();
    });
    expect(devicesRead()).toBe(2);
    expect(pi.findSonosOnPi).toHaveBeenCalledTimes(2);
    expect(airplay.listAudioOutputs).toHaveBeenCalled();
    await act(async () => {
      answer.resolve({ devices: [] });
      await done;
    });
    expect(result.current.refreshing).toBe(false);
  });
});
