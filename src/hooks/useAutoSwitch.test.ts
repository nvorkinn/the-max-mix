import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonOnKiosk } from '../spotify/auth';
import type { SavedPhone } from './useSavedPhones';
import { useAutoSwitch, whoToSwitchTo } from './useAutoSwitch';

const mocks = vi.hoisted(() => ({
  people: [] as PersonOnKiosk[],
  watchPresence: vi.fn(() => Promise.resolve()),
  readBluetoothReport: vi.fn(),
  debugLog: vi.fn()
}));
vi.mock('../spotify/auth', () => ({ peopleOnKiosk: () => mocks.people }));
vi.mock('../utils/bluetoothMonitor', () => ({
  watchPresence: mocks.watchPresence,
  readBluetoothReport: mocks.readBluetoothReport
}));
vi.mock('../utils/debugLog', () => ({ debugLog: mocks.debugLog }));

const person = (spotifyId: string, phoneAddress: string, more: Partial<PersonOnKiosk> = {}): PersonOnKiosk => ({
  spotifyId,
  name: spotifyId,
  imageUrl: '',
  phoneAddress,
  active: false,
  signedIn: true,
  ...more
});
const heard = (...addresses: string[]): SavedPhone[] =>
  addresses.map(address => ({ address, name: address, isHere: true }));

const nikolai = person('nikolai', 'AA:AA', { active: true });
const sam = person('sam', 'BB:BB');
const kim = person('kim', 'CC:CC');

describe('whoToSwitchTo', () => {
  it('switches to the one other person heard when the active person is not', () => {
    expect(whoToSwitchTo([nikolai, sam, kim], heard('bb:bb'))).toBe('sam');
  });

  it('stays when the active person is heard', () => {
    expect(whoToSwitchTo([nikolai, sam], heard('AA:AA', 'BB:BB'))).toBeNull();
  });

  it('stays when more than one other person is heard', () => {
    expect(whoToSwitchTo([nikolai, sam, kim], heard('BB:BB', 'CC:CC'))).toBeNull();
  });

  it('stays when nobody else is heard', () => {
    expect(whoToSwitchTo([nikolai, sam], [{ address: 'BB:BB', name: 'B', isHere: false }])).toBeNull();
  });

  it('stays when the active person has no phone linked', () => {
    expect(whoToSwitchTo([{ ...nikolai, phoneAddress: '' }, sam], heard('BB:BB'))).toBeNull();
  });

  it('does not switch to someone who is signed out', () => {
    expect(whoToSwitchTo([nikolai, { ...sam, signedIn: false }], heard('BB:BB'))).toBeNull();
  });
});

type Props = Parameters<typeof useAutoSwitch>[0];
const onSwitch = vi.fn();
const DEFAULTS: Props = { enabled: true, asleep: false, dimmed: false, isPlaying: false, isBusy: false, onSwitch };

function renderAutoSwitch(props: Partial<Props> = {}) {
  const hook = renderHook((p: Props) => useAutoSwitch(p), { initialProps: { ...DEFAULTS, ...props } });
  return { ...hook, rerender: (next: Partial<Props>) => hook.rerender({ ...DEFAULTS, ...next }) };
}

/** The Pi's answers in turn: still checking with nothing heard, then done with `phones`. */
function piHears(phones: SavedPhone[], checkingReads = 1) {
  for (let read = 0; read < checkingReads; read += 1) {
    mocks.readBluetoothReport.mockResolvedValueOnce({ phones: [], presenceChecking: true });
  }
  mocks.readBluetoothReport.mockResolvedValue({ phones, presenceChecking: false });
}

describe('useAutoSwitch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.readBluetoothReport.mockReset();
    mocks.people = [nikolai, sam];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const wakeFromDim = async (hook: ReturnType<typeof renderAutoSwitch>, props: Partial<Props> = {}) => {
    hook.rerender({ dimmed: true, ...props });
    hook.rerender(props);
    await act(() => vi.advanceTimersByTimeAsync(5000));
  };

  it('on waking, switches to the one other person heard when the active person is not', async () => {
    piHears(heard('BB:BB'));
    const hook = renderAutoSwitch();
    await wakeFromDim(hook);
    expect(mocks.watchPresence).toHaveBeenNthCalledWith(1, true);
    expect(mocks.watchPresence).toHaveBeenLastCalledWith(false);
    expect(onSwitch).toHaveBeenCalledWith('sam', false);
  });

  it('stops listening early and stays once the active person is heard', async () => {
    mocks.readBluetoothReport.mockResolvedValue({ phones: heard('AA:AA', 'BB:BB'), presenceChecking: true });
    const hook = renderAutoSwitch();
    await wakeFromDim(hook);
    expect(mocks.readBluetoothReport).toHaveBeenCalledTimes(1);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('does not switch when music started while it listened', async () => {
    piHears(heard('BB:BB'), 3);
    const hook = renderAutoSwitch();
    hook.rerender({ dimmed: true });
    hook.rerender({});
    hook.rerender({ isPlaying: true });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('does not even listen while music plays, or when nobody else has a phone linked', async () => {
    const hook = renderAutoSwitch();
    await wakeFromDim(hook, { isPlaying: true });
    mocks.people = [nikolai, person('sam', '')];
    await wakeFromDim(hook);
    expect(mocks.watchPresence).not.toHaveBeenCalled();
  });

  it('checks every five minutes while asleep, and says it switched asleep', async () => {
    piHears(heard('BB:BB'));
    renderAutoSwitch({ asleep: true });
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000 - 1));
    expect(mocks.watchPresence).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(onSwitch).toHaveBeenCalledWith('sam', true);
  });

  it('gives up when the Pi never finishes checking', async () => {
    mocks.readBluetoothReport.mockResolvedValue({ phones: [], presenceChecking: true });
    const hook = renderAutoSwitch();
    await wakeFromDim(hook);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(onSwitch).not.toHaveBeenCalled();
    expect(mocks.watchPresence).toHaveBeenLastCalledWith(false);
  });

  it('logs and stays when the Pi cannot say', async () => {
    mocks.readBluetoothReport.mockRejectedValue(new Error('no Pi'));
    const hook = renderAutoSwitch();
    await wakeFromDim(hook);
    expect(onSwitch).not.toHaveBeenCalled();
    expect(mocks.debugLog).toHaveBeenCalledWith('warn', 'presence', 'Woken: no Pi');
  });

  it('does nothing off the kiosk', async () => {
    const hook = renderAutoSwitch({ enabled: false });
    hook.rerender({ enabled: false, dimmed: true });
    hook.rerender({ enabled: false });
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(mocks.watchPresence).not.toHaveBeenCalled();
  });
});
